/**
 * MLB ticket management session handler.
 *
 * Login flow: mlb.tickets.com → Okta email verification → read OTP from DB → done.
 * Session state is persisted in the MLB_SESSION_STATE env var (JSON, base64-encoded).
 * When the session expires, this module re-authenticates automatically.
 *
 * Proxy strategy: WebShare SOCKS5 requires auth, but Chromium can't use authenticated
 * SOCKS5. We spin up a local Node.js HTTP CONNECT proxy on 127.0.0.1 that tunnels
 * through WebShare's SOCKS5 using the `socks` package. Playwright uses the local
 * unauthenticated HTTP proxy; auth is handled internally.
 */

import * as net from "net";
import { chromium, BrowserContext } from "playwright-core";
import { SocksClient } from "socks";
import { prisma } from "../prisma";

const TICKET_MGMT_URL =
  "https://mlb.tickets.com/ticketmanagement/?orgid=39129&agency=MARM_MYTIXX#/";
const MLB_EMAIL = process.env.MLB_DEPOSITS_EMAIL ?? "deposits@buzzerseats.com";

/**
 * Starts a local HTTP CONNECT proxy that forwards connections through an upstream
 * authenticated SOCKS5 proxy. Chromium cannot use authenticated SOCKS5 natively,
 * so this bridge accepts unauthenticated CONNECT requests locally and handles auth.
 */
async function startSocks5Bridge(socksUrl: string): Promise<{
  port: number;
  close: () => void;
}> {
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
        {
          proxy: { host: socksHost, port: socksPort, type: 5, userId, password },
          command: "connect",
          destination: { host: destHost, port: destPort },
        },
        (err, info) => {
          if (err || !info) {
            console.error(`[MLBSession] SOCKS5 bridge error for ${destHost}:${destPort}: ${err?.message ?? "no info"}`);
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
      console.log(`[MLBSession] SOCKS5 bridge: 127.0.0.1:${port} → ${socksHost}:${socksPort}`);
      resolve({ port, close: () => server.close() });
    });
    server.on("error", reject);
  });
}

export async function getAuthenticatedContext(): Promise<{
  context: BrowserContext;
  close: () => Promise<void>;
}> {
  const proxyUrl = process.env.BRIGHTDATA_PROXY_URL;
  let proxy: { server: string; username?: string; password?: string } | undefined;
  let bridgeClose: (() => void) | undefined;

  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      if (u.protocol === "socks5:" || u.protocol === "socks5h:") {
        // Chromium cannot use authenticated SOCKS5 — bridge through a local HTTP proxy
        const bridge = await startSocks5Bridge(proxyUrl);
        bridgeClose = bridge.close;
        proxy = { server: `http://127.0.0.1:${bridge.port}` };
      } else {
        proxy = {
          server: `${u.protocol}//${u.host}`,
          ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
          ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
        };
        console.log(`[MLBSession] Proxy configured: ${u.protocol}//${u.host} (auth: ${!!u.username})`);
      }
    } catch {
      proxy = { server: proxyUrl };
    }
  } else {
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

  // Navigate and wait for either the dashboard (logged in) or Okta redirect
  const page = await context.newPage();
  await page.goto(TICKET_MGMT_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  console.log(`[MLBSession] Loaded: ${page.url()}`);

  // Wait up to 15s for the page to either show "HI," (logged in) or redirect to Okta
  const isLoggedIn = await page.locator("text=HI,").first()
    .isVisible({ timeout: 15_000 }).catch(() => false);

  if (!isLoggedIn) {
    console.log("[MLBSession] Not logged in — waiting for Okta redirect...");
    await doLogin(page);
  }

  await page.close();

  return {
    context,
    close: async () => {
      await browser.close();
      bridgeClose?.();
    },
  };
}

async function doLogin(page: any): Promise<void> {
  // Page is already on mlb.tickets.com — wait for Angular to redirect to Okta
  console.log(`[MLBSession] Waiting for Okta redirect from: ${page.url()}`);
  await page.waitForURL(/okta\.com|login\.|auth\./i, { timeout: 60_000 });
  console.log(`[MLBSession] Redirected to Okta: ${page.url()}`);

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
