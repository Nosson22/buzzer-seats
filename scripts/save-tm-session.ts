#!/usr/bin/env ts-node
/**
 * Run this script locally (on your Mac) to log into Ticketmaster manually
 * and save the session cookies as TM_SESSION_STATE for the Railway worker.
 *
 * Usage:
 *   npx ts-node --project tsconfig.server.json scripts/save-tm-session.ts
 *
 * Then copy the printed base64 string and set it as TM_SESSION_STATE in
 * Railway → imaginative-embrace → Variables.
 */

import { chromium } from "playwright-core";
import * as fs from "fs";

const BASE_URL = "https://am.ticketmaster.com/heat/";

async function main() {
  console.log("Opening browser — please log in to Ticketmaster when the window appears.");
  console.log("After you are fully logged in and see 'My Tickets', press Enter here.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for user to log in
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
    console.log("\nPress Enter after you are fully logged in...");
  });

  const state = await context.storageState();
  await browser.close();

  const json = JSON.stringify(state);
  const b64 = Buffer.from(json).toString("base64");

  fs.writeFileSync("tm-session-state.b64.txt", b64, "utf-8");
  console.log("\n✅ Session saved to tm-session-state.b64.txt");
  console.log("Set this as TM_SESSION_STATE in Railway environment variables:");
  console.log("(file written — copy its contents into Railway Variables)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
