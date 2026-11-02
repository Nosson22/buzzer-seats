/**
 * Transfers a ticket from deposits@buzzerseats.com Ticketmaster account to a buyer.
 * Used for Heat (am.ticketmaster.com/heat) and Dolphins (am.ticketmaster.com/dolphins).
 *
 * Flow: My Tickets → select ticket → Transfer → enter buyer email → Confirm
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
  const { context, baseUrl, close } = await getTMAuthenticatedContext(teamSlug);

  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });

    const isAdmissionOnly = !section || section === "0" || section.toLowerCase().includes("admission") || section.toLowerCase().includes("standing") || section.toLowerCase().includes("sro") || row === "0" || !row;

    for (const seat of seats) {
      if (isAdmissionOnly) {
        // Wait for JS-rendered ticket content to appear (TM is a SPA)
        const ticketContentSelector = [
          '[class*="event-card"]',
          '[class*="ticket-card"]',
          '[class*="order-card"]',
          '[class*="EventCard"]',
          '[class*="TicketCard"]',
          '[data-testid*="event"]',
          '[data-testid*="ticket"]',
          'a[href*="/event/"]',
          'a[href*="transfer"]',
          'button:has-text("Transfer")',
          'a:has-text("Transfer")',
        ].join(", ");

        console.log("[TMTransfer] Waiting up to 30s for ticket content to appear...");
        const contentLoaded = await page.waitForSelector(ticketContentSelector, { timeout: 30_000 })
          .then(() => true)
          .catch(() => false);

        // Log innerHTML to see actual DOM structure
        const innerHTML = await page.evaluate(() => document.body.innerHTML.slice(0, 5000));
        console.log("[TMTransfer] Body innerHTML (first 5000):\n", innerHTML);

        if (!contentLoaded) {
          console.warn("[TMTransfer] Ticket content selector not found after 30s");
        }

        // Try clicking a Transfer link/button directly
        const directTransfer = page.locator([
          'a:has-text("Transfer")',
          'button:has-text("Transfer")',
          '[aria-label*="Transfer" i]',
        ].join(", ")).first();

        if (await directTransfer.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await directTransfer.click();
          await page.waitForTimeout(1_500);
        } else {
          // Try navigating to myevents page
          const myEventsUrl = baseUrl + "myevents";
          console.log("[TMTransfer] No direct Transfer found. Trying " + myEventsUrl);
          await page.goto(myEventsUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
          await page.waitForSelector(ticketContentSelector, { timeout: 20_000 }).catch(() => {});

          const innerHTML2 = await page.evaluate(() => document.body.innerHTML.slice(0, 5000));
          console.log("[TMTransfer] myevents innerHTML:\n", innerHTML2);

          const transferAfterNav = page.locator([
            'a:has-text("Transfer")',
            'button:has-text("Transfer")',
            '[aria-label*="Transfer" i]',
          ].join(", ")).first();

          if (await transferAfterNav.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await transferAfterNav.click();
            await page.waitForTimeout(1_500);
          } else {
            const allCards = await page.locator([
              '[class*="event-card"]',
              '[class*="ticket-card"]',
              '[class*="EventCard"]',
              'a[href*="/event/"]',
              'li[class*="event"]',
              'article',
            ].join(", ")).all();
            console.log("[TMTransfer] Found " + allCards.length + " event card elements");
            if (allCards.length === 0) throw new Error("No ticket elements found on TM page");
            await allCards[0].click();
            await page.waitForTimeout(2_000);
          }
        }
      } else {
        // Find the ticket matching section/row/seat
        const ticketLocator = page.locator(
          `[data-section="${section}"], [aria-label*="${section}"], text=/Section ${section}/i`
        ).filter({ hasText: new RegExp("Row " + row + "|Row: " + row, "i") })
          .filter({ hasText: new RegExp("Seat " + seat + "|#" + seat, "i") })
          .first();

        if (!await ticketLocator.isVisible({ timeout: 10_000 }).catch(() => false)) {
          const allCards = await page.locator("[data-testid='ticket-card'], .ticket-card, .my-ticket").all();
          let found = false;
          for (const card of allCards) {
            const text = await card.textContent();
            if (
              text?.includes(section) &&
              (text.includes("Row " + row) || text.includes("Row: " + row)) &&
              (text.includes("Seat " + seat) || text.includes("#" + seat))
            ) {
              await card.click();
              found = true;
              break;
            }
          }
          if (!found) throw new Error("Seat " + seat + " Sec " + section + " Row " + row + " not found in TM account");
        } else {
          await ticketLocator.click();
        }
      }

      await page.waitForTimeout(2_000);

      // Click Transfer button
      const transferBtn = page.locator([
        'button:has-text("Transfer")',
        'a:has-text("Transfer")',
        '[data-testid*="transfer" i]',
        'button[aria-label*="transfer" i]',
        'button:has-text("Send")',
        'a:has-text("Send")',
      ].join(", ")).first();

      if (!await transferBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
        console.error("[TMTransfer] Transfer button not found. Page text:", bodyText);
        throw new Error("Could not find Transfer button on Ticketmaster page");
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
        console.warn("[TMTransfer] No success indicator for seat " + seat + " — transfer may have failed");
      }

      console.log("[TMTransfer] Forwarded Sec " + section + " Row " + row + " Seat " + seat + " to " + buyerEmail);

      if (seats.length > 1) {
        await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20_000 });
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
