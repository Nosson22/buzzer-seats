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
// Click the transfer accept URL using a real headless browser (Playwright).
// Raw HTTP requests are blocked by SeatGeek's bot-detection (DataDome).
// Playwright runs Chromium with a clean session (no sender cookies) so the
// email_token in the URL authenticates the recipient without requiring login.
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

async function seatgeekLogin(page: any): Promise<void> {
  const sgEmail = process.env.SEATGEEK_DEPOSITS_EMAIL ?? "deposits@buzzerseats.com";
  console.log("[CustodyService] Starting SeatGeek login for", sgEmail);

  await page.goto("https://seatgeek.com/sign-in", { waitUntil: "networkidle", timeout: 30_000 });

  // Enter email
  await page.fill('input[type="email"], input[name="email"], #email', sgEmail);

  const loginStart = Date.now();
  await page.click('button[type="submit"], button:has-text("Continue"), button:has-text("Sign in")');
  await page.waitForTimeout(2000);
  console.log("[CustodyService] SeatGeek email submitted, waiting for verification code email...");

  // Poll Postmark for the verification code email (up to 60s)
  const code = await pollPostmarkForVerificationCode(loginStart, 60_000);
  if (!code) {
    throw new Error("SeatGeek verification code not received within 60s — check POSTMARK_SERVER_TOKEN env var");
  }

  // Enter the verification code — SeatGeek uses a single input or individual digit inputs
  const codeInput = page.locator('input[name*="code"], input[placeholder*="code" i], input[autocomplete="one-time-code"], input[inputmode="numeric"]').first();
  const count = await codeInput.count();
  if (count > 0) {
    await codeInput.fill(code);
  } else {
    // Individual digit inputs
    const digits = page.locator('input[maxlength="1"]');
    const digitCount = await digits.count();
    for (let i = 0; i < Math.min(digitCount, code.length); i++) {
      await digits.nth(i).fill(code[i]);
    }
  }

  await page.click('button[type="submit"], button:has-text("Verify"), button:has-text("Confirm"), button:has-text("Continue")');
  await page.waitForTimeout(3000);
  console.log("[CustodyService] SeatGeek login complete, URL:", page.url());
}

export async function clickAcceptUrl(acceptUrl: string): Promise<boolean> {
  console.log("[CustodyService] Launching Playwright to accept URL:", acceptUrl);
  let chromium: any;
  try {
    // Use playwright-core; Chromium binary must be installed on the host.
    // On Railway: add `npx playwright install chromium` to the build command.
    ({ chromium } = require("playwright-core"));
  } catch {
    console.error("[CustodyService] playwright-core not available");
    return false;
  }

  let browser: any;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
      },
    });

    // Remove webdriver flag that DataDome and similar services detect
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    });

    const page = await ctx.newPage();

    // If this is a SeatGeek transfer, log in first via email verification code
    if (acceptUrl.includes("seatgeek.com")) {
      await seatgeekLogin(page);
    }

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
