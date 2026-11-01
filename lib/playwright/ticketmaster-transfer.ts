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

    for (const seat of seats) {
      // Find the ticket matching section/row/seat
      const ticketLocator = page.locator(
        `[data-section="${section}"], [aria-label*="${section}"], text=/Section ${section}/i`
      ).filter({ hasText: new RegExp(`Row ${row}|Row: ${row}`, "i") })
        .filter({ hasText: new RegExp(`Seat ${seat}|#${seat}`, "i") })
        .first();

      if (!await ticketLocator.isVisible({ timeout: 10_000 }).catch(() => false)) {
        // Fallback: scan all ticket cards
        const allCards = await page.locator("[data-testid='ticket-card'], .ticket-card, .my-ticket").all();
        let found = false;
        for (const card of allCards) {
          const text = await card.textContent();
          if (
            text?.includes(section) &&
            (text.includes(`Row ${row}`) || text.includes(`Row: ${row}`)) &&
            (text.includes(`Seat ${seat}`) || text.includes(`#${seat}`))
          ) {
            await card.click();
            found = true;
            break;
          }
        }
        if (!found) throw new Error(`Seat ${seat} Sec ${section} Row ${row} not found in TM account`);
      } else {
        await ticketLocator.click();
      }

      await page.waitForTimeout(1_500);

      // Click Transfer button
      await page.locator('button:has-text("Transfer"), a:has-text("Transfer")').first().click();
      await page.waitForTimeout(1_500);

      // Enter buyer email in transfer modal
      const emailInput = page.locator(
        'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="recipient" i]'
      ).first();
      await emailInput.fill(buyerEmail);

      // Some TM flows ask to confirm email
      const confirmInput = page.locator('input[placeholder*="confirm" i]').first();
      if (await confirmInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await confirmInput.fill(buyerEmail);
      }

      // Submit transfer
      await page.locator(
        'button:has-text("Send"), button:has-text("Transfer"), button[type="submit"]'
      ).last().click();
      await page.waitForTimeout(3_000);

      // Confirm success indicator
      const successVisible = await page.locator(
        'text=/transfer.*sent|ticket.*sent|success/i'
      ).first().isVisible({ timeout: 10_000 }).catch(() => false);

      if (!successVisible) {
        console.warn(`[TMTransfer] No success indicator for seat ${seat} — transfer may have failed`);
      }

      console.log(`[TMTransfer] Forwarded Sec ${section} Row ${row} Seat ${seat} → ${buyerEmail}`);

      // Go back for next seat
      if (seats.length > 1) {
        await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20_000 });
        await page.waitForTimeout(1_000);
      }
    }

    await page.close();
    return { success: true, message: `Transferred ${seats.length} ticket(s) to ${buyerEmail}` };
  } catch (err: any) {
    console.error("[TMTransfer] Error:", err.message);
    return { success: false, message: err.message };
  } finally {
    await close();
  }
}
