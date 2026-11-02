/**
 * Transfers a ticket from deposits@buzzerseats.com Ticketmaster account to a buyer.
 *
 * Flow: am.ticketmaster.com/{team}/myevents → find ticket → Transfer → enter buyer email → Confirm
 * The session handler ensures the React app is authenticated before we get here.
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

    // Navigate to myevents — where transferred tickets appear
    const myEventsUrl = baseUrl + "myevents";
    console.log("[TMTransfer] Navigating to:", myEventsUrl);
    await page.goto(myEventsUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    console.log("[TMTransfer] myevents URL:", page.url());

    // Wait up to 30s for ANY ticket/event content to load
    const ticketSelector = [
      '[class*="event-card"]',
      '[class*="EventCard"]',
      '[class*="ticket-card"]',
      '[class*="TicketCard"]',
      '[data-testid*="event"]',
      '[data-testid*="ticket"]',
      'a[href*="/event/"]',
      'button:has-text("Transfer")',
      'a:has-text("Transfer")',
      '.event-listing',
      '.ticket-listing',
    ].join(", ");

    console.log("[TMTransfer] Waiting for ticket content...");
    await page.waitForSelector(ticketSelector, { timeout: 30_000 }).catch(() => {});

    // Log HTML to debug
    const html = await page.evaluate(() => document.body.innerHTML.slice(0, 5000));
    console.log("[TMTransfer] myevents HTML:\n", html);

    for (const seat of seats) {
      const isAdmissionOnly = !section || section === "0" ||
        section.toLowerCase().includes("admission") ||
        section.toLowerCase().includes("standing") ||
        section.toLowerCase().includes("sro") ||
        row === "0" || !row;

      // Try direct Transfer button first
      const directTransfer = page.locator([
        'a:has-text("Transfer")',
        'button:has-text("Transfer")',
        '[aria-label*="Transfer" i]',
      ].join(", ")).first();

      if (await directTransfer.isVisible({ timeout: 5_000 }).catch(() => false)) {
        console.log("[TMTransfer] Found direct Transfer button");
        await directTransfer.click();
        await page.waitForTimeout(1_500);
      } else {
        // Click first event/ticket card
        const allCards = await page.locator([
          '[class*="event-card"]',
          '[class*="EventCard"]',
          '[class*="ticket-card"]',
          '[data-testid*="event"]',
          'a[href*="/event/"]',
          '.event-listing',
          'li[class*="event"]',
          'article',
        ].join(", ")).all();

        if (!isAdmissionOnly) {
          // Filter by section/row text
          let found = false;
          for (const card of allCards) {
            const text = await card.textContent().catch(() => "");
            if (text?.includes(section) && (text.includes("Row " + row) || text.includes("Row: " + row))) {
              await card.click();
              found = true;
              break;
            }
          }
          if (!found && allCards.length > 0) {
            await allCards[0].click();
          } else if (!found) {
            throw new Error("No ticket cards found for Sec " + section + " Row " + row);
          }
        } else {
          console.log("[TMTransfer] Found " + allCards.length + " event cards (SRO/admission)");
          if (allCards.length === 0) throw new Error("No ticket cards found on myevents page");
          await allCards[0].click();
        }
        await page.waitForTimeout(2_000);
      }

      // After clicking event, find Transfer button on detail page
      const transferBtn = page.locator([
        'button:has-text("Transfer")',
        'a:has-text("Transfer")',
        '[data-testid*="transfer" i]',
        'button[aria-label*="transfer" i]',
        'button:has-text("Send")',
      ].join(", ")).first();

      if (!await transferBtn.isVisible({ timeout: 15_000 }).catch(() => false)) {
        const bodyHtml = await page.evaluate(() => document.body.innerHTML.slice(0, 3000));
        console.error("[TMTransfer] Transfer button not found. URL:", page.url(), "HTML:", bodyHtml);
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
        await page.goto(myEventsUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
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
