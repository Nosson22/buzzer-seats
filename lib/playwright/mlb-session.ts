/**
 * MLB ticket management session handler.
 *
 * Login flow: mlb.tickets.com → Okta email verification → read OTP from DB → done.
 * Session state is persisted in the MLB_SESSION_STATE env var (JSON, base64-encoded).
 * When the session expires, this module re-authenticates automatically.
 */

import { chromium, BrowserContext } from "playwright-core";
import { prisma } from "../prisma";

const TICKET_MGMT_URL =
  "https://mlb.tickets.com/ticketmanagement/?orgid=39129&agency=MARM_MYTIXX#/";
const MLB_EMAIL = process.env.MLB_DEPOSITS_EMAIL ?? "deposits@buzzerseats.com";

export async function getAuthenticatedContext(): Promise<{
  context: BrowserContext;
  close: () => Promise<void>;
}> {
  // Residential proxy — required because mlb.tickets.com blocks datacenter IPs
  // Set BRIGHTDATA_PROXY_URL=http://user:pass@brd.superproxy.io:22225 in Railway env
  const proxyUrl = process.env.BRIGHTDATA_PROXY_URL;
  const proxy = proxyUrl
    ? { server: proxyUrl }
    : undefined;

  if (!proxy) {
    console.warn("[MLBSession] No BRIGHTDATA_PROXY_URL set — mlb.tickets.com may block this request");
  }

  const browser = await chromium.launch({
    headless: true,
    proxy,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  // Try restoring saved session
  const savedState = process.env.MLB_SESSION_STATE
    ? JSON.parse(Buffer.from(process.env.MLB_SESSION_STATE, "base64").toString("utf-8"))
    : null;

  const context = await browser.newContext({
    storageState: savedState ?? undefined,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    proxy,
  });

  // Check if session is still valid
  const page = await context.newPage();
  await page.goto(TICKET_MGMT_URL, { waitUntil: "networkidle", timeout: 30_000 });

  const isLoggedIn = await page.locator("text=HI,").first().isVisible({ timeout: 5_000 }).catch(() => false);

  if (!isLoggedIn) {
    console.log("[MLBSession] Session expired or missing — re-authenticating");
    await doLogin(page);
  }

  await page.close();

  return {
    context,
    close: async () => {
      await browser.close();
    },
  };
}

async function doLogin(page: any): Promise<void> {
  // Navigate to trigger Okta redirect
  await page.goto(TICKET_MGMT_URL, { waitUntil: "networkidle", timeout: 30_000 });

  console.log(`[MLBSession] Landed on: ${page.url()}`);
  const emailLocator = page.locator(
    'input[type="email"], input[name="username"], input[name="identifier"]'
  );
  const found = await emailLocator
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  if (!found) {
    const title = await page.title().catch(() => "?");
    const bodyText = await page.locator("body").innerText().catch(() => "?");
    const allInputs = await page.locator("input").evaluateAll((els: any[]) =>
      els.map((e) => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder }))
    ).catch(() => []);
    console.log(`[MLBSession] DEBUG title="${title}" url=${page.url()}`);
    console.log(`[MLBSession] DEBUG inputs=${JSON.stringify(allInputs)}`);
    console.log(`[MLBSession] DEBUG bodyText snippet: ${bodyText.slice(0, 1000)}`);
    throw new Error("Email input not found — see DEBUG logs above");
  }

  // Fill in email on Okta login page
  await page.locator('input[type="email"], input[name="username"], input[name="identifier"]').fill(MLB_EMAIL);
  await page.locator('button[type="submit"], input[type="submit"]').click();
  await page.waitForTimeout(2_000);

  // If there's a "Send code" or "Email me" button, click it
  const sendCodeBtn = page.locator('button:has-text("Send"), button:has-text("Email"), button:has-text("code")').first();
  if (await sendCodeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await sendCodeBtn.click();
    await page.waitForTimeout(2_000);
  }

  // Poll DB for the OTP (stored by inbound email webhook)
  console.log("[MLBSession] Waiting for OTP email to arrive...");
  const otp = await waitForOTP();

  if (!otp) throw new Error("OTP not received within timeout");

  // Enter the OTP
  await page.locator('input[type="text"], input[name="code"], input[name="passcode"]').fill(otp);
  await page.locator('button[type="submit"], input[type="submit"]').click();
  await page.waitForURL(/ticketmanagement/, { timeout: 30_000 });

  console.log("[MLBSession] Login successful");
}

async function waitForOTP(timeoutMs = 60_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await prisma.otpCode.findFirst({
      where: {
        service: "MLB_OKTA",
        usedAt: null,
        createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
    });

    if (record) {
      await prisma.otpCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      return record.code;
    }

    await new Promise((r) => setTimeout(r, 3_000));
  }
  return null;
}
