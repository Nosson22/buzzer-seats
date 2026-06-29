/**
 * Transfers a ticket from the Buzzer Seats MLB account to a buyer via
 * mlb.tickets.com Forward flow (web-based, no Android emulator needed).
 */

import { getAuthenticatedContext } from "./mlb-session";

const TICKET_MGMT_URL =
  "https://mlb.tickets.com/ticketmanagement/?orgid=39129&agency=MARM_MYTIXX#/";

export interface TransferParams {
  section: string;
  row: string;
  seatNumbers: string; // e.g. "8" or "8,9,10"
  buyerEmail: string;
}

export async function transferTicketToBuyer(params: TransferParams): Promise<{ success: boolean; message: string }> {
  const { section, row, seatNumbers, buyerEmail } = params;
  const seats = seatNumbers.split(",").map((s) => s.trim());
  const { context, close } = await getAuthenticatedContext();

  try {
    const page = await context.newPage();
    await page.goto(TICKET_MGMT_URL, { waitUntil: "networkidle", timeout: 30_000 });

    // Click into the next event's tickets
    await page.locator("button:has-text('View Tickets')").first().click();
    await page.waitForTimeout(2_000);

    // Find and click each seat
    for (const seat of seats) {
      const seatBtn = page.locator(`button:has-text("Seat ${seat}"):has-text("${section}")`).first();
      if (!await seatBtn.isVisible({ timeout: 5_000 })) {
        // Try a broader search
        const allBtns = await page.locator("button").all();
        let found = false;
        for (const btn of allBtns) {
          const text = await btn.textContent();
          if (text?.includes(section) && text?.includes(row) && text?.includes(seat)) {
            await btn.click();
            found = true;
            break;
          }
        }
        if (!found) throw new Error(`Seat ${seat} in ${section} Row ${row} not found`);
      } else {
        await seatBtn.click();
      }

      await page.waitForTimeout(1_500);

      // Open Ticket Actions dropdown
      await page.locator("button:has-text('Ticket Actions')").click();
      await page.waitForTimeout(500);

      // Click Forward
      await page.locator("button:has-text('Forward'), a:has-text('Forward')").last().click();
      await page.waitForTimeout(1_500);

      // Fill in buyer email
      const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
      await emailInput.fill(buyerEmail);

      // Submit
      await page.locator("button:has-text('Forward'), button:has-text('Send'), button[type='submit']").last().click();
      await page.waitForTimeout(2_000);

      console.log(`[Transfer] Forwarded Sec ${section} Row ${row} Seat ${seat} → ${buyerEmail}`);

      // Go back to ticket list for next seat
      if (seats.length > 1) {
        await page.goBack();
        await page.waitForTimeout(1_000);
      }
    }

    await page.close();
    return { success: true, message: `Transferred ${seats.length} ticket(s) to ${buyerEmail}` };
  } catch (err: any) {
    console.error("[Transfer] Error:", err.message);
    return { success: false, message: err.message };
  } finally {
    await close();
  }
}
