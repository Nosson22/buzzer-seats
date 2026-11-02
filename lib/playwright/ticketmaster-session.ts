/**
 * Ticketmaster Account Manager session handler.
 *
 * Used for Heat (am.ticketmaster.com/heat) and Dolphins (am.ticketmaster.com/dolphins).
 * Login flow: email → password → SMS/email OTP (if prompted).
 *
 * The React app inside the Account Manager needs to be authenticated via the Sign In modal,
 * not just the server-side session cookies.
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
  const teamSubdomains: Record<string, string> = {
    heat: "heat",
    dolphins: "dolphins",
  };
  const subdomain = teamSubdomains[teamSlug] ?? teamSlug;
  const baseUrl = `https://am.ticketmaster.com/${subdomain}/`;

  const proxyUrl = process.env.BRIGHTDATA_PROXY_URL;
  let proxy: { server: string; username?: string; password?: string } | undefined;
  let bridgeClose: (() => void) | undefined;

  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      if (u.protocol === "socks5:" || u.protocol === "socks5h:") {
        const bridge = await startSocks5Bridge(proxyUrl);
        bridgeClose = bridge.close;
        proxy = { server: `http://127.0.0.1:${bridge.port}` };
      } else {
        proxy = {
          server: `${u.protocol}//${u.host}`,
          username: decodeURIComponent(u.username) || undefined,
          password: decodeURIComponent(u.password) || undefined,
        };
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

  const currentUrl = page.url();
  console.log(`[TMSession] After initial load, URL: ${currentUrl}`);

  if (currentUrl.includes("identity.ticketmaster.com") || currentUrl.includes("/login") || currentUrl.includes("/signin")) {
    console.log("[TMSession] Redirected to login page — doing full login flow...");
    await doTMLogin(page, baseUrl);
  } else {
    // On the Account Manager page — check if React app shows Sign In button (not authenticated at app level)
    console.log("[TMSession] On Account Manager, checking if React app is authenticated...");
    await page.waitForTimeout(2_000);

    const signInBtn = page.locator('#signInBtn, button:has-text("Sign In")').first();
    const signInVisible = await signInBtn.isVisible({ timeout: 3_000 }).catch(() => false);

    if (signInVisible) {
      console.log("[TMSession] React app shows Sign In — clicking to open login modal...");
      await signInBtn.click();
      await page.waitForTimeout(2_000);

      // The click either opens a modal or redirects to identity.ticketmaster.com
      const afterClickUrl = page.url();
      console.log("[TMSession] After Sign In click, URL:", afterClickUrl);

      if (afterClickUrl.includes("identity.ticketmaster.com") || afterClickUrl.includes("auth.ticketmaster.com")) {
        await doTMLogin(page, baseUrl);
      } else {
        // Modal opened — find email/password fields inside the modal
        await doTMLoginModal(page, baseUrl);
      }
    } else {
      console.log("[TMSession] Already logged in at:", currentUrl);
    }
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

async function doTMLoginModal(page: any, baseUrl: string): Promise<void> {
  // Login modal is open — fill credentials
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[id="email"]',
    'input[autocomplete="email"]',
    'input[placeholder*="email" i]',
  ];

  let emailFilled = false;
  for (const sel of emailSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await el.fill(TM_EMAIL);
      emailFilled = true;
      console.log(`[TMSession] Modal: filled email using ${sel}`);
      break;
    }
  }

  if (!emailFilled) {
    // Modal might have redirected after all
    const html = await page.content();
    console.warn("[TMSession] Could not find email field in modal. URL:", page.url(), "HTML:", html.slice(0, 1000));
    // Try the full login flow just in case
    await doTMLogin(page, baseUrl);
    return;
  }

  const submitSelectors = ['button[type="submit"]', 'button:has-text("Sign In")', 'button:has-text("Next")', 'button:has-text("Continue")'];
  for (const sel of submitSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await el.click();
      break;
    }
  }
  await page.waitForTimeout(2_000);

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

  // Handle OTP
  const otpField = page.locator('input[name="code"], input[name="otp"], input[placeholder*="code" i]').first();
  if (await otpField.isVisible({ timeout: 8_000 }).catch(() => false)) {
    console.log("[TMSession] OTP required in modal...");
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
  }

  // Wait for modal to close and user to be logged in
  await page.waitForSelector('#signInBtn', { state: 'hidden', timeout: 15_000 }).catch(() => {});
  console.log("[TMSession] Modal login complete");
}

async function doTMLogin(page: any, baseUrl: string): Promise<void> {
  await page.waitForURL(/identity\.ticketmaster\.com|auth\.ticketmaster\.com|ticketmaster\.com.*login|ticketmaster\.com.*signin/i, { timeout: 30_000 })
    .catch(() => {});

  console.log(`[TMSession] On login page: ${page.url()}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(4_000);
  // Log what we see to debug Cloudflare vs real login page
  const loginPageHtml = await page.content().catch(() => "");
  console.log("[TMSession] Login page HTML (first 3000):", loginPageHtml.slice(0, 3000));

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
    const html = await page.content();
    console.error("[TMSession] Could not find email field. Page URL:", page.url());
    console.error("[TMSession] Page HTML (first 2000 chars):", html.slice(0, 2000));
    throw new Error(`Could not find email input on ${page.url()}`);
  }

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
