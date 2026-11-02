/**
 * Transfers a ticket from deposits@buzzerseats.com Ticketmaster account to a buyer.
 *
 * The deposits account receives tickets via transfer from sellers.
 * Tickets live at my.ticketmaster.com (standard TM account), NOT the team Account Manager.
 *
 * Flow: my.ticketmaster.com → find event → Transfer → enter buyer email → Confirm
 */

import { getTMAuthenticatedContext } from "./ticketmaster-session";

export interface TMTransferParams {
  teamSlug: string;
  section: string;
  row: string;
  seatNumbers: string;
  buyerEmail: string;
}

export async function transferTicketToBuyerTM(params: TMTransferParams): Promise<{ success: boolean; message: string }> {
  const { teamSlug, section, row, seatNumbers, buyerEmail } = params;
  const seats = seatNumbers.split(",").map((s) => s.trim());
  const { context, close } = await getTMAuthenticatedContext(teamSlug);

  // Tickets received via transfer live at my.ticketmaster.com, not the team Account Manager
  const myTMUrl = "https://my.ticketmaster.com/";

  try {
    const page = await context.newPage();
    await page.goto(myTMUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    console.log("[TMTransfer] Navigated to my.ticketmaster.com, URL:", page.url());

    // Wait for ticket cards to load
    const ticketSelector = [
      '[class*="event-card"]',
      '[class*="EventCard"]',
      '[class*="ticket"]',
      '[data-testid*="event"]',
      '[data-testid*="ticket"]',
      'a[href*="/event/"]',
    ].join(", ");

    console.log("[TMTransfer] Waiting for ticket content...");
    await page.waitForSelector(ticketSelector, { timeout: 30_000 }).catch(() => {});

    // Log page HTML for debugging
    const html = await page.evaluate(() => document.body.innerHTML.slice(0, 4000));
    console.log("[TMTransfer] my.ticketmaster.com HTML:\n", html);

    for (const seat of seats) {
      const isAdmissionOnly = !section || section === "0" ||
        section.toLowerCase().includes("admission") ||
        section.toLowerCase().includes("standing") ||
        section.toLowerCase().includes("sro") ||
        row === "0" || !row;

      // Try to find a Transfer button directly (TM sometimes shows it inline)
      const directTransfer = page.locator([
        'a:has-text("Transfer")',
        'button:has-text("Transfer")',
        '[aria-label*="Transfer" i]',
      ].join(", ")).first();

      if (await directTransfer.isVisible({ timeout: 5_000 }).catch(() => false)) {
        console.log("[TMTransfer] Found direct Transfer button");
        await directTransfer.click();
        await page.waitForTimeout(1_500);
      } else if (isAdmissionOnly) {
        // Click the first event card
        const allCards = await page.locator([
          '[class*="event-card"]',
          '[class*="EventCard"]',
          '[data-testid*="event"]',
          'a[href*="/event/"]',
          'article',
          'li[class*="event"]',
          'li[class*="ticket"]',
          '[role="listitem"]',
        ].join(", ")).all();
        console.log("[TMTransfer] Found " + allCards.length + " event cards");
        if (allCards.length === 0) throw new Error("No ticket cards found at my.ticketmaster.com");
        await allCards[0].click();
        await page.waitForTimeout(2_000);
      } else {
        // Find ticket by section/row/seat
        const allCards = await page.locator("*").all();
        let found = false;
        for (const card of allCards.slice(0, 100)) {
          const text = await card.textContent().catch(() => "");
          if (text?.includes(section) &&
            (text.includes("Row " + row) || text.includes("Row: " + row))) {
            await card.click();
            found = true;
            break;
          }
        }
        if (!found) throw new Error("Ticket Sec " + section + " Row " + row + " not found at my.ticketmaster.com");
      }

      await page.waitForTimeout(2_000);

      // After clicking event, find Transfer button on detail page
      const transferBtn = page.locator([
        'button:has-text("Transfer")',
        'a:has-text("Transfer")',
        '[data-testid*="transfer" i]',
        'button[aria-label*="transfer" i]',
        'button:has-text("Send")',
      ].join(", ")).first();

      if (!await transferBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        const bodyHtml = await page.evaluate(() => document.body.innerHTML.slice(0, 3000));
        console.error("[TMTransfer] Transfer button not found. HTML:", bodyHtml);
        throw new Error("Could not find Transfer button");
      }
      await transferBtn.click();
      await page.waitForTimeout(1_500);

      // Enter buyer email
      const emailInput = page.locator(
        'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="recipient" i]'
      ).first();
      await emailInput.fill(buyerEmail);

      const confirmInput = page.locator('input[placeholder*="confirm" i]').first();
      if (await confirmInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await confirmInput.fill(buyerEmail);
      }

      await page.locator(
        'button:has-text("Send"), button:has-text("Transfer"), button[type="submit"]'
      ).last().click();
      await page.waitForTimeout(3_000);

      const successVisible = await page.locator(
        'text=/transfer.*sent|ticket.*sent|success/i'
      ).first().isVisible({ timeout: 10_000 }).catch(() => false);

      if (!successVisible) {
        console.warn("[TMTransfer] No success indicator — transfer may have failed");
      }

      console.log("[TMTransfer] Forwarded Sec " + section + " Row " + row + " Seat " + seat + " to " + buyerEmail);

      if (seats.length > 1) {
        await page.goto(myTMUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(1_000);
      }
    }

    await page.close();
    return { success: true, message: "Transferred " + seats.length + " ticket(s) to " + buyerEmail };
  } catch (err: any) {
    console.error("[TMTransfer] Error:", err.message);
    return { success: false, message: err.message };
  } finally {
    await close();
  }
}
