/**
 * SeatGeek session handler — used for Tampa Bay Buccaneers tickets.
 *
 * SeatGeek's ticket management is at my.seatgeek.com.
 * Login: email → password (no OTP on most flows, but handled if present).
 *
 * Session state persisted in SG_SESSION_STATE env var (JSON, base64-encoded).
 * Proxy strategy: same SOCKS5 bridge as mlb-session.ts.
 */

import * as net from "net";
import { chromium, BrowserContext } from "playwright-core";
import { SocksClient } from "socks";
import { prisma } from "../prisma";

const SG_EMAIL = process.env.SG_DEPOSITS_EMAIL ?? "deposits@buzzerseats.com";
const SG_PASSWORD = process.env.SG_DEPOSITS_PASSWORD ?? "";
const SG_TICKETS_URL = "https://seatgeek.com/account/tickets";

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
            console.error(`[SGSession] SOCKS5 bridge error for ${destHost}:${destPort}: ${err?.message ?? "no info"}`);
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
      console.log(`[SGSession] SOCKS5 bridge: 127.0.0.1:${port} → ${socksHost}:${socksPort}`);
      resolve({ port, close: () => server.close() });
    });
    server.on("error", reject);
  });
}

export async function getSGAuthenticatedContext(): Promise<{
  context: BrowserContext;
  close: () => Promise<void>;
}> {
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

  const savedState = process.env.SG_SESSION_STATE
    ? JSON.parse(Buffer.from(process.env.SG_SESSION_STATE, "base64").toString("utf-8"))
    : null;

  const context = await browser.newContext({
    storageState: savedState ?? undefined,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    proxy,
  });

  const page = await context.newPage();
  await page.goto(SG_TICKETS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  console.log(`[SGSession] Loaded: ${page.url()}`);

  const isLoggedIn = await page.locator('[data-testid="user-menu"], .sg-account, text=My Tickets').first()
    .isVisible({ timeout: 10_000 }).catch(() => false);

  if (!isLoggedIn) {
    console.log("[SGSession] Not logged in — starting SeatGeek login...");
    await doSGLogin(page);
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

async function doSGLogin(page: any): Promise<void> {
  await page.goto("https://seatgeek.com/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log(`[SGSession] On login page: ${page.url()}`);

  await page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').fill(SG_EMAIL);

  const passwordField = page.locator('input[type="password"], input[name="password"]').first();
  if (await passwordField.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await passwordField.fill(SG_PASSWORD);
  }

  await page.locator('button[type="submit"], button:has-text("Log In"), button:has-text("Sign In")').first().click();
  await page.waitForTimeout(3_000);

  // Handle OTP / magic link if SeatGeek prompts for it
  const otpField = page.locator('input[name="code"], input[placeholder*="code" i]').first();
  if (await otpField.isVisible({ timeout: 8_000 }).catch(() => false)) {
    console.log("[SGSession] OTP required — waiting...");
    const otp = await waitForOTP("SG_LOGIN");
    if (!otp) throw new Error("SeatGeek OTP not received within timeout");
    await otpField.fill(otp);
    await page.locator('button[type="submit"], button:has-text("Verify")').first().click();
    await page.waitForTimeout(2_000);
  }

  await page.waitForURL(/seatgeek\.com/, { timeout: 20_000 });
  console.log("[SGSession] Login successful");
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
