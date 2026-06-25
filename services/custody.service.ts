/**
 * Custody Service — Phase 3: Inbound Email → LIVE
 *
 * Called from POST /api/inbound/email when the inbound email webhook fires.
 *
 * Flow:
 *   1. Parse the forwarded MLB email to extract section / row / seat
 *   2. Match to a DRAFT listing by sellerId + gameId + section + row + seat
 *   3. Accept the transfer: flip DRAFT → LIVE, set activatedAt
 *   4. Schedule the expiry job (Phase 4)
 *   5. Broadcast to the buyer marketplace (WebSocket)
 *   6. Email the seller confirming their listing is now live
 *
 * The inbound email payload shape matches Postmark's inbound webhook.
 * If you're using SendGrid or Resend, adapt `parseInboundPayload` accordingly.
 */
import { prisma } from "../lib/prisma";
import { getTeamConfig } from "../lib/team-config";
import { scheduleExpiry } from "../lib/queue/expiry.queue";
import { emitListingAvailable } from "../lib/socket/emitters";
import { sendListingLiveEmail } from "../lib/email";
import { scheduleTransferToBuyer } from "../lib/queue/mlb-automation.queue";

// ---------------------------------------------------------------------------
// Inbound email payload (Postmark shape — adapt for other providers)
// ---------------------------------------------------------------------------
export interface InboundEmailPayload {
  From: string;           // e.g. "jsmith@example.com"
  To: string;             // should be deposits@buzzerseats.com
  Subject: string;
  TextBody: string;
  HtmlBody: string;
  Attachments?: Array<{
    Name: string;
    Content: string;      // base64
    ContentType: string;
  }>;
}

// ---------------------------------------------------------------------------
// MLB Ballpark email parser
// Extracts section, row, seat from the forwarded ticket email body.
// These patterns cover the standard MLB Ballpark app transfer email format.
// ---------------------------------------------------------------------------
export interface ParsedTicketInfo {
  section: string;
  row: string;
  seatNumbers: string;
}

// Works with MLB Ballpark, SeatGeek, Ticketmaster, AXS, and similar
export function parseMLBTicketEmail(
  subject: string,
  textBody: string,
  htmlBody: string
): ParsedTicketInfo | null {
  const html = htmlBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const corpus = `${subject}\n${textBody}\n${html}`;

  const patterns = [
    // SeatGeek: "Section 102, Row 5, Seats 1-2" or "Sec 102 · Row 5 · Seat 1"
    /sec(?:tion)?[.:\s·•]+([a-z0-9]+)[^a-z0-9]+row[.:\s·•]+([a-z0-9]+)[^a-z0-9]+seat[s]?[.:\s·•]+([a-z0-9,\s–-]+)/i,
    // MLB Ballpark: "Section 15 · Row C · Seat 4"
    /section[:\s.]*([a-z0-9]+)[^a-z0-9]*row[:\s.]*([a-z0-9]+)[^a-z0-9]*seat[s]?[:\s.]*([a-z0-9,\s–-]+)/i,
    // Ticketmaster/AXS: "Sec 101 / Row J / Seats 5-6"
    /sec(?:tion)?[.:\s/]+([a-z0-9]+)[^a-z0-9]+row[.:\s/]+([a-z0-9]+)[^a-z0-9]+seat[s]?[.:\s/]+([a-z0-9,\s–-]+)/i,
    // Fallback: row + seat without section
    /row[.:\s]+([a-z0-9]+)[^a-z0-9]+seat[s]?[.:\s]+([a-z0-9,\s–-]+)/i,
  ];

  for (const pattern of patterns) {
    const m = corpus.match(pattern);
    if (m) {
      if (m.length >= 4) {
        return {
          section: m[1].trim().toUpperCase(),
          row: m[2].trim().toUpperCase(),
          seatNumbers: m[3].trim().replace(/[–—]/g, "-").toUpperCase(),
        };
      }
      if (m.length === 3) {
        return {
          section: "UNKNOWN",
          row: m[1].trim().toUpperCase(),
          seatNumbers: m[2].trim().replace(/[–—]/g, "-").toUpperCase(),
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Match parsed ticket info to a DRAFT listing
// ---------------------------------------------------------------------------
// Normalize section string: strip common prefixes so "SEC40" == "40" == "Section 40"
function normalizeSection(s: string): string {
  return s.replace(/^sec(?:tion)?\.?\s*/i, "").trim().toUpperCase();
}

async function matchDraftListing(
  senderEmail: string,
  parsed: ParsedTicketInfo
) {
  const normalizedSection = normalizeSection(parsed.section);

  // Pull all recent DRAFT listings and match in JS so we can normalize sections
  const candidates = await prisma.listing.findMany({
    where: { status: "DRAFT" },
    include: {
      game: { include: { team: true } },
      seller: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const match = candidates.find(l =>
    normalizeSection(l.section) === normalizedSection &&
    l.row.toUpperCase() === parsed.row.toUpperCase()
  );

  return match ?? null;
}

// ---------------------------------------------------------------------------
// Extract MLB transfer accept URL from the email body.
// MLB sends a button/link like "Accept Tickets" that points to a tokenized URL.
// The token in the URL is all that's needed — no authenticated session required.
// ---------------------------------------------------------------------------
export function extractAcceptUrl(htmlBody: string, textBody: string): string | null {
  // Patterns for the MLB transfer accept link (cover known formats)
  const urlPatterns = [
    // MLB Ballpark: any href on mlb.com or ballpark.mlb.com containing "accept" or "transfer"
    /href="(https?:\/\/(?:[^"]*\.)?(?:mlb\.com|bamnetworks\.com)[^"]*(?:accept|transfer)[^"]+)"/i,
    /href='(https?:\/\/(?:[^']*\.)?(?:mlb\.com|bamnetworks\.com)[^']*(?:accept|transfer)[^']+)'/i,
    // Other ticketing platforms
    /href="(https?:\/\/(?:[^"]*\.)?(?:ticketmaster\.com|seatgeek\.com|axs\.com|livenation\.com)[^"]*(?:accept|transfer)[^"]+)"/i,
    /href='(https?:\/\/(?:[^']*\.)?(?:ticketmaster\.com|seatgeek\.com|axs\.com|livenation\.com)[^']*(?:accept|transfer)[^']+)'/i,
    // Generic HTML href with accept/transfer + any query param
    /href="(https?:\/\/[^"]*(?:accept|transfer)[^"]*\?[^"]+)"/i,
    /href='(https?:\/\/[^']*(?:accept|transfer)[^']*\?[^']+)'/i,
    // Plain-text URL with token or accept keyword
    /(https?:\/\/\S*(?:accept|transfer)\S*)/i,
  ];

  const corpus = `${htmlBody}\n${textBody}`;
  for (const pattern of urlPatterns) {
    const m = corpus.match(pattern);
    if (m?.[1]) {
      // Decode HTML entities (&amp; → &)
      return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// SeatGeek API — pure HTTP approach, no browser needed.
//
// Discovered endpoints (via browser DevTools inspection):
//   PUT /api/transfers/{id}/{signature}/accept  → accepts a pending transfer
//   GET /api/transfers                          → lists transfers for the account
//
// Auth: two cookies required —
//   rCookie   = SeatGeek session (lasts ~2 years, stored in SEATGEEK_SESSION_COOKIE)
//   datadome  = DataDome bot-clearance (solved per-request via CapSolver)
//
// CapSolver (capsolver.com) solves DataDome challenges for ~$0.002 each.
// Set CAPSOLVER_API_KEY in Railway env vars to enable.
// ---------------------------------------------------------------------------

const SG_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

async function solveDatadome(pageUrl: string): Promise<string | null> {
  const apiKey = process.env.CAPSOLVER_API_KEY;
  if (!apiKey) {
    console.warn("[CustodyService] CAPSOLVER_API_KEY not set — cannot solve DataDome");
    return null;
  }

  // Step 1: hit the page to get the DataDome challenge URL
  const initialRes = await fetch(pageUrl, {
    headers: { "User-Agent": SG_USER_AGENT, "Accept": "application/json" },
  });
  const body = await initialRes.text();

  // DataDome returns a JSON redirect: {"url":"https://geo.captcha-delivery.com/captcha/?..."}
  let challengeUrl: string | null = null;
  try {
    const parsed = JSON.parse(body);
    challengeUrl = parsed.url ?? null;
  } catch {
    const m = body.match(/"url"\s*:\s*"(https:\/\/geo\.captcha-delivery\.com[^"]+)"/);
    if (m) challengeUrl = m[1];
  }

  if (!challengeUrl) {
    console.log("[CustodyService] No DataDome challenge needed for", pageUrl);
    return null; // no challenge — request was allowed through
  }

  console.log("[CustodyService] Solving DataDome challenge via CapSolver...");

  // Step 2: create CapSolver task (proxy is required for DatadomeSliderTask)
  // WEBSHARE_PROXY format: http://user:pass@host:port
  // CapSolver DatadomeSliderTask expects: http:user:pass:host:port
  const proxyUrl = process.env.WEBSHARE_PROXY;
  if (!proxyUrl) {
    console.error("[CustodyService] WEBSHARE_PROXY not set — DatadomeSliderTask requires a proxy");
    return null;
  }
  let proxy = proxyUrl;
  try {
    const u = new URL(proxyUrl);
    proxy = `${u.protocol.replace(":", "")}:${u.username}:${u.password}:${u.hostname}:${u.port}`;
  } catch {
    console.warn("[CustodyService] Could not parse WEBSHARE_PROXY as URL, using raw value");
  }
  console.log("[CustodyService] CapSolver proxy format:", proxy.replace(/:[^:]+:[^:]+:/, ":***:***:"));
  const createRes = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: "DatadomeSliderTask",
        websiteURL: pageUrl,
        captchaUrl: challengeUrl,
        userAgent: SG_USER_AGENT,
        proxy,
      },
    }),
  });
  const createData = await createRes.json() as any;
  if (createData.errorId) {
    console.error("[CustodyService] CapSolver createTask error:", createData.errorDescription);
    return null;
  }
  const taskId = createData.taskId as string;

  // Step 3: poll for result (up to 120s)
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const resultRes = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const result = await resultRes.json() as any;
    if (result.status === "ready") {
      const cookie = result.solution?.cookie as string | undefined;
      if (cookie) {
        // cookie is returned as "datadome=VALUE"
        const val = cookie.replace(/^datadome=/, "");
        console.log("[CustodyService] DataDome solved, cookie length:", val.length);
        return val;
      }
    }
    if (result.status === "failed" || result.errorId) {
      console.error("[CustodyService] CapSolver task failed:", result.errorDescription ?? result.status);
      return null;
    }
  }

  console.error("[CustodyService] CapSolver timed out after 120s");
  return null;
}

async function seatgeekApiAccept(transferId: string, signature: string): Promise<boolean> {
  const sessionCookie = process.env.SEATGEEK_SESSION_COOKIE;
  if (!sessionCookie) {
    console.error("[CustodyService] SEATGEEK_SESSION_COOKIE not set");
    return false;
  }

  const acceptUrl = `https://seatgeek.com/api/transfers/${transferId}/${signature}/accept`;
  console.log("[CustodyService] Accepting SeatGeek transfer via API:", acceptUrl);

  // Solve DataDome using the actual transfer page (not an API endpoint) so DataDome fires
  const transferPageUrl = `https://seatgeek.com/transfers/${transferId}/${signature}`;
  const datadome = await solveDatadome(transferPageUrl);
  const cookieHeader = datadome
    ? `rCookie=${sessionCookie}; datadome=${datadome}`
    : `rCookie=${sessionCookie}`;

  const res = await fetch(acceptUrl, {
    method: "PUT",
    headers: {
      "Cookie": cookieHeader,
      "User-Agent": SG_USER_AGENT,
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Referer": `https://seatgeek.com/transfers/${transferId}/${signature}`,
      "Origin": "https://seatgeek.com",
    },
    body: JSON.stringify({}),
  });

  const text = await res.text();
  console.log("[CustodyService] SeatGeek accept response:", res.status, text.slice(0, 200));

  if (res.status === 400 && /already accepted/i.test(text)) {
    console.log("[CustodyService] Transfer was already accepted — treating as success");
    return true;
  }

  return res.status >= 200 && res.status < 300;
}

// ---------------------------------------------------------------------------
async function pollPostmarkForVerificationCode(
  afterMs: number,
  timeoutMs = 60_000
): Promise<string | null> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    console.warn("[CustodyService] POSTMARK_SERVER_TOKEN not set — cannot fetch verification code");
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch("https://api.postmarkapp.com/messages/inbound?count=5&offset=0", {
        headers: { "X-Postmark-Server-Token": token, "Accept": "application/json" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const messages: any[] = data.InboundMessages ?? [];

      for (const msg of messages) {
        // Only consider messages that arrived after we triggered the login
        const receivedAt = new Date(msg.ReceivedAt ?? 0).getTime();
        if (receivedAt < afterMs) continue;
        if (!/seatgeek/i.test(msg.From ?? "")) continue;

        // Fetch full message to get text body
        const detailRes = await fetch(
          `https://api.postmarkapp.com/messages/inbound/${msg.MessageID}/details`,
          { headers: { "X-Postmark-Server-Token": token, "Accept": "application/json" } }
        );
        if (!detailRes.ok) continue;
        const detail = await detailRes.json();
        const text = `${detail.TextBody ?? ""} ${detail.Subject ?? ""}`;

        // Extract 4-8 digit verification code
        const match = text.match(/\b([0-9]{4,8})\b/);
        if (match) {
          console.log("[CustodyService] Got SeatGeek verification code:", match[1]);
          return match[1];
        }
      }
    } catch {}
  }
  return null;
}

async function seatgeekLogin(page: any, transferUrl: string): Promise<void> {
  const sgEmail = process.env.SEATGEEK_DEPOSITS_EMAIL ?? "deposits@buzzerseats.com";
  console.log("[CustodyService] Navigating to transfer URL first to trigger SeatGeek login flow");

  // Go directly to the transfer URL — SeatGeek will redirect to login if not authenticated.
  // This avoids DataDome blocking the standalone /sign-in page.
  await page.goto(transferUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(2000);
  console.log("[CustodyService] Transfer URL loaded, current URL:", page.url());

  // Check if we're already on the transfer page (already logged in) or redirected to login
  const currentUrl = page.url();
  const isOnLogin = /sign.?in|login|auth/i.test(currentUrl) ||
    await page.locator('input[type="email"], input[name="email"]').count() > 0;

  if (!isOnLogin) {
    console.log("[CustodyService] Already authenticated or on transfer page");
    return;
  }

  console.log("[CustodyService] Login required, entering email:", sgEmail);
  const loginStart = Date.now();

  // Fill email — SeatGeek's auth modal may have various selectors
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  await emailInput.waitFor({ timeout: 15_000 });
  await emailInput.fill(sgEmail);
  await page.click('button[type="submit"], button:has-text("Continue"), button:has-text("Sign in"), button:has-text("Send")');
  await page.waitForTimeout(2000);
  console.log("[CustodyService] Email submitted, polling for verification code...");

  // Poll Postmark for the OTP (up to 60s)
  const code = await pollPostmarkForVerificationCode(loginStart, 60_000);
  if (!code) {
    throw new Error("SeatGeek verification code not received within 60s — check POSTMARK_SERVER_TOKEN env var");
  }

  // Enter the OTP — single input or individual digit inputs
  const codeInput = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code"]').first();
  const hasCodeInput = await codeInput.count() > 0;
  if (hasCodeInput) {
    await codeInput.fill(code);
  } else {
    const digits = page.locator('input[maxlength="1"]');
    const digitCount = await digits.count();
    for (let i = 0; i < Math.min(digitCount, code.length); i++) {
      await digits.nth(i).fill(code[i]);
    }
  }

  await page.click('button[type="submit"], button:has-text("Verify"), button:has-text("Confirm"), button:has-text("Continue")');
  await page.waitForTimeout(4000);
  console.log("[CustodyService] SeatGeek login complete, URL:", page.url());
}

export async function clickAcceptUrl(acceptUrl: string): Promise<boolean> {
  // SeatGeek: use pure API approach — no browser, no DataDome Playwright issues
  if (acceptUrl.includes("seatgeek.com/transfers/")) {
    const m = acceptUrl.match(/seatgeek\.com\/(?:api\/)?transfers\/(\d+)\/([a-f0-9]+)/i);
    if (!m) {
      console.error("[CustodyService] Could not parse SeatGeek transfer URL:", acceptUrl);
      return false;
    }
    return seatgeekApiAccept(m[1], m[2]);
  }

  // Non-SeatGeek platforms: use Playwright
  console.log("[CustodyService] Launching Playwright to accept URL:", acceptUrl);
  let chromium: any;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    console.error("[CustodyService] playwright-core not available");
    return false;
  }

  let browser: any;
  try {
    const proxyUrl = process.env.PROXY_URL;
    browser = await chromium.launch({
      headless: true,
      proxy: proxyUrl ? { server: proxyUrl } : undefined,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });
    const ctx = await browser.newContext({
      userAgent: SG_USER_AGENT,
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();

    await page.goto(acceptUrl, { waitUntil: "networkidle", timeout: 30_000 });

    // Look for the Accept button and click it (MLB uses "Accept Tickets" or "Accept Transfer")
    const acceptBtn = page.locator("button, [role='button'], a").filter({ hasText: /accept/i });
    const count = await acceptBtn.count();
    if (count === 0) {
      const bodyText = await page.textContent("body") ?? "";
      // If the page says already accepted / expired, treat as success
      if (/already accepted|expired|no longer/i.test(bodyText)) {
        console.log("[CustodyService] Transfer already accepted or expired");
        return true;
      }
      console.error("[CustodyService] Accept button not found. Page text:", bodyText.slice(0, 300));
      return false;
    }

    await acceptBtn.first().click();

    // Wait for success state — SeatGeek shows a confirmation or redirects
    await page.waitForTimeout(4_000);
    const finalUrl = page.url();
    const finalText = await page.textContent("body") ?? "";
    console.log("[CustodyService] After click — url:", finalUrl, "text:", finalText.slice(0, 200));

    // Success if: no error message, or page shows confirmation
    const failed = /can't accept your own|error|failed/i.test(finalText);
    return !failed;
  } catch (err: any) {
    console.error("[CustodyService] Playwright accept failed:", err.message);
    return false;
  } finally {
    await browser?.close();
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function processCustodyEmail(
  payload: InboundEmailPayload
): Promise<{ ok: boolean; listingId?: string; reason?: string }> {
  // 1. Extract the MLB accept transfer URL from the email body
  const acceptUrl = extractAcceptUrl(payload.HtmlBody, payload.TextBody);

  if (!acceptUrl) {
    console.warn("[CustodyService] No accept URL found in email — subject:", payload.Subject);
    // Still try to parse ticket info for matching, but we can't auto-accept without the URL
    return { ok: false, reason: "No transfer accept URL found in email body" };
  }

  console.log("[CustodyService] Found accept URL:", acceptUrl);

  // 2. Parse the MLB ticket email to identify the listing
  const parsed = parseMLBTicketEmail(
    payload.Subject,
    payload.TextBody,
    payload.HtmlBody
  );

  if (!parsed) {
    console.warn("[CustodyService] Could not parse ticket info from email — subject:", payload.Subject);
    return { ok: false, reason: "Could not parse ticket info from email" };
  }

  // 3. Match to a DRAFT listing
  const listing = await matchDraftListing(payload.From, parsed);

  if (!listing) {
    console.warn(
      `[CustodyService] No matching DRAFT listing for section=${parsed.section} row=${parsed.row} from=${payload.From}`
    );
    return { ok: false, reason: "No matching draft listing found" };
  }

  // 4. Click the accept URL — this accepts the transfer on MLB's side
  const accepted = await clickAcceptUrl(acceptUrl);

  const now = new Date();
  await prisma.listing.update({
    where: { id: listing.id },
    data: {
      custodyEmail: payload.From,
      custodyTransferredAt: now,
      ...(accepted ? { status: "LIVE", activatedAt: now } : {}),
    },
  });

  if (!accepted) {
    console.error(`[CustodyService] Accept URL click failed for listing ${listing.id} — manual review needed`);
    return { ok: false, reason: "Accept URL click failed", listingId: listing.id };
  }

  console.log(`[CustodyService] Transfer accepted for listing ${listing.id}`);

  // 5. Find active buyer reservation for this listing (if any) and queue transfer-to-buyer
  const reservation = await prisma.reservation.findFirst({
    where: { listingId: listing.id, status: "ACTIVE" },
    include: { buyer: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (reservation?.buyer?.email) {
    await scheduleTransferToBuyer(listing.id, reservation.buyer.email);
    console.log(`[CustodyService] Queued transfer-to-buyer for listing ${listing.id} → ${reservation.buyer.email}`);
  } else {
    console.log(`[CustodyService] No active buyer reservation yet for listing ${listing.id} — listing is now LIVE`);
    // Broadcast availability so buyers can see and reserve it
    try {
      emitListingAvailable(listing.game.id, {
        listingId: listing.id,
        gameId: listing.game.id,
        section: listing.section,
        row: listing.row,
        seatNumbers: listing.seatNumbers,
        quantity: listing.quantity,
        askingPrice: listing.askingPrice,
        triggeredBy: listing.liveTriggerType,
        activatedAt: now.toISOString(),
      });
    } catch (err: any) {
      console.warn("[CustodyService] WebSocket emit failed (non-fatal):", err.message);
    }
  }

  // 6. Email seller confirming transfer received and listing is live
  const { expiryOffsetMs, expiryLabel } = getTeamConfig(listing.game.team.slug);
  const expiryAt = new Date(listing.game.gameTime.getTime() + expiryOffsetMs);
  sendListingLiveEmail({
    to: listing.seller.email,
    sellerName: listing.seller.name,
    game: `${listing.game.awayTeam} at ${listing.game.homeTeam}`,
    section: listing.section,
    row: listing.row,
    seatNumbers: listing.seatNumbers,
    askingPrice: listing.askingPrice,
    expiryLabel,
    expiresAt: expiryAt,
  }).catch((e) => console.error("[CustodyService] Live email failed:", e.message));

  return { ok: true, listingId: listing.id };
}
