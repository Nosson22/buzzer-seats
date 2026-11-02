/**
 * Ticketmaster Account Manager session handler.
 *
 * Used for Heat (am.ticketmaster.com/heat) and Dolphins (am.ticketmaster.com/dolphins).
 * Login flow: email → password → SMS/email OTP (if prompted).
 *
 * Session state is persisted in TM_SESSION_STATE env var (JSON, base64-encoded).
 * Proxy strategy: same SOCKS5 bridge as mlb-session — see mlb-session.ts for details.
 */

import * as net from "net";
import { chromium, BrowserContext } from "playwright-core";
import { SocksClient } from "socks";
import { prisma } from "../prisma";

const TM_EMAIL = process.env.TICKETMASTER_EMAIL ?? process.env.TM_DEPOSITS_EMAIL ?? "deposits@buzzerseats.com";
const TM_PASSWORD = process.env.TICKETMASTER_PASSWORD ?? process.env.TM_DEPOSITS_PASSWORD ?? "";

async function startSocks5Bridge(socksUrl: string): Promise<{ port: number; close: () => void }> {
  const u = new URL(socksUrl);
  const socksHost = u.hostname;
  const socksPort = parseInt(u.port) || 1080;
  const userId = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);

  const server = net.createServer((clientSocket) => {
    let headerBuf = Buffer.alloc(0);
    let headerDone = false;

    const onData = (chunk: Buffer) => {
      if (headerDone) return;
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const sep = headerBuf.indexOf("\r\n\r\n");
      if (sep === -1) return;

      headerDone = true;
      clientSocket.removeListener("data", onData);

      const header = headerBuf.slice(0, sep).toString();
      const tail = headerBuf.slice(sep + 4);
      const match = header.match(/^CONNECT ([^:\s]+):(\d+)/i);

      if (!match) {
        clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }

      const destHost = match[1];
      const destPort = parseInt(match[2]);

      SocksClient.createConnection(
        { proxy: { host: socksHost, port: socksPort, type: 5, userId, password }, command: "connect", destination: { host: destHost, port: destPort } },
        (err, info) => {
          if (err || !info) {
            console.error(`[TMSession] SOCKS5 bridge error for ${destHost}:${destPort}: ${err?.message ?? "no info"}`);
            clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            return;
          }
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (tail.length > 0) info.socket.write(tail);
          info.socket.pipe(clientSocket);
          clientSocket.pipe(info.socket);
          info.socket.on("error", () => clientSocket.destroy());
          clientSocket.on("error", () => info.socket.destroy());
        }
      );
    };

    clientSocket.on("data", onData);
    clientSocket.on("error", () => {});
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      console.log(`[TMSession] SOCKS5 bridge: 127.0.0.1:${port} → ${socksHost}:${socksPort}`);
      resolve({ port, close: () => server.close() });
    });
    server.on("error", reject);
  });
}

export async function getTMAuthenticatedContext(teamSlug: string): Promise<{
  context: BrowserContext;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  // Each team has its own Account Manager subdomain
  const teamSubdomains: Record<string, string> = {
    heat: "heat",
    dolphins: "dolphins",
  };
  const subdomain = teamSubdomains[teamSlug] ?? teamSlug;
  const baseUrl = `https://am.ticketmaster.com/${subdomain}/`;

  const proxyUrl = process.env.BRIGHTDATA_PROXY_URL;
  let proxy: { server: string } | undefined;
  let bridgeClose: (() => void) | undefined;

  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      if (u.protocol === "socks5:" || u.protocol === "socks5h:") {
        const bridge = await startSocks5Bridge(proxyUrl);
        bridgeClose = bridge.close;
        proxy = { server: `http://127.0.0.1:${bridge.port}` };
      } else {
        proxy = { server: `${u.protocol}//${u.host}` };
      }
    } catch {
      proxy = { server: proxyUrl };
    }
  }

  const browser = await chromium.launch({
    headless: true,
    proxy,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const savedState = process.env.TM_SESSION_STATE
    ? JSON.parse(Buffer.from(process.env.TM_SESSION_STATE, "base64").toString("utf-8"))
    : null;

  const context = await browser.newContext({
    storageState: savedState ?? undefined,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    proxy,
  });

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  console.log(`[TMSession] Loaded: ${page.url()}`);

  // Ticketmaster redirects to login if session expired
  const isLoggedIn = await page.locator('[data-testid="account-menu"], .tm-account-menu, text=My Account').first()
    .isVisible({ timeout: 10_000 }).catch(() => false);

  if (!isLoggedIn) {
    console.log("[TMSession] Not logged in — starting TM login flow...");
    await doTMLogin(page, baseUrl);
  }

  await page.close();

  return {
    context,
    baseUrl,
    close: async () => {
      await browser.close();
      bridgeClose?.();
    },
  };
}

async function doTMLogin(page: any, baseUrl: string): Promise<void> {
  // Wait for redirect to identity.ticketmaster.com (their SSO)
  await page.waitForURL(/identity\.ticketmaster\.com|ticketmaster\.com.*login|ticketmaster\.com.*signin/i, { timeout: 30_000 })
    .catch(() => {});

  console.log(`[TMSession] On login page: ${page.url()}`);

  // Wait for the page to fully load
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2_000);

  // Try all common email field selectors
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[id="email"]',
    'input[autocomplete="email"]',
    'input[placeholder*="email" i]',
    'input[data-testid*="email" i]',
  ];

  let emailFilled = false;
  for (const sel of emailSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await el.fill(TM_EMAIL);
      emailFilled = true;
      console.log(`[TMSession] Filled email using selector: ${sel}`);
      break;
    }
  }

  if (!emailFilled) {
    // Log page HTML for debugging
    const html = await page.content();
    console.error("[TMSession] Could not find email field. Page URL:", page.url());
    console.error("[TMSession] Page HTML (first 2000 chars):", html.slice(0, 2000));
    throw new Error(`Could not find email input on ${page.url()}`);
  }

  // Click Next/Continue/Sign In
  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Sign In")',
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'input[type="submit"]',
  ];
  for (const sel of submitSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await el.click();
      break;
    }
  }
  await page.waitForTimeout(2_000);

  // Fill password (may be on same page or next step)
  const passwordField = page.locator('input[type="password"], input[name="password"]').first();
  if (await passwordField.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await passwordField.fill(TM_PASSWORD);
    for (const sel of submitSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await el.click();
        break;
      }
    }
    await page.waitForTimeout(3_000);
  }

  // Handle OTP if prompted
  const otpField = page.locator('input[name="code"], input[name="otp"], input[placeholder*="code" i], input[placeholder*="verification" i]').first();
  if (await otpField.isVisible({ timeout: 8_000 }).catch(() => false)) {
    console.log("[TMSession] OTP required — waiting for code...");
    const otp = await waitForOTP("TM_LOGIN");
    if (!otp) throw new Error("Ticketmaster OTP not received within timeout");
    await otpField.fill(otp);
    for (const sel of submitSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await el.click();
        break;
      }
    }
    await page.waitForTimeout(2_000);
  }

  // Wait for redirect back to Account Manager
  await page.waitForURL(/am\.ticketmaster\.com/, { timeout: 30_000 });
  console.log("[TMSession] Login successful");
}

async function waitForOTP(service: string, timeoutMs = 120_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await prisma.otpCode.findFirst({
      where: {
        service,
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
