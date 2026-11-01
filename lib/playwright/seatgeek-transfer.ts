/**
 * Transfers a ticket from deposits@buzzerseats.com SeatGeek account to a buyer.
 * Used for Tampa Bay Buccaneers tickets.
 *
 * Flow: My Tickets → select ticket → Transfer → enter buyer email → Send
 */

import { getSGAuthenticatedContext } from "./seatgeek-session";

export interface SGTransferParams {
  section: string;
  row: string;
  seatNumbers: string;
  buyerEmail: string;
}

export async function transferTicketToBuyerSG(params: SGTransferParams): Promise<{ success: boolean; message: string }> {
  const { section, row, seatNumbers, buyerEmail } = params;
  const seats = seatNumbers.split(",").map((s) => s.trim());
  const { context, close } = await getSGAuthenticatedContext();

  try {
    const page = await context.newPage();
    await page.goto("https://seatgeek.com/account/tickets", { waitUntil: "networkidle", timeout: 30_000 });

    for (const seat of seats) {
      // Find the ticket matching section/row/seat
      const allTickets = await page.locator("[data-testid='ticket-item'], .ticket-item, .my-ticket-row").all();
      let found = false;

      for (const ticket of allTickets) {
        const text = await ticket.textContent();
        if (
          text?.toLowerCase().includes(section.toLowerCase()) &&
          (text.includes(`Row ${row}`) || text.includes(`Row: ${row}`) || text.includes(` ${row} `)) &&
          (text.includes(`Seat ${seat}`) || text.includes(`Seat: ${seat}`) || text.includes(` ${seat}`))
        ) {
          await ticket.click();
          found = true;
          break;
        }
      }

      if (!found) throw new Error(`Seat ${seat} Sec ${section} Row ${row} not found in SeatGeek account`);

      await page.waitForTimeout(1_500);

      // Click Transfer
      await page.locator('button:has-text("Transfer"), a:has-text("Transfer")').first().click();
      await page.waitForTimeout(1_500);

      // Enter buyer email
      const emailInput = page.locator(
        'input[type="email"], input[name="email"], input[placeholder*="email" i]'
      ).first();
      await emailInput.fill(buyerEmail);

      // Submit
      await page.locator(
        'button:has-text("Send"), button:has-text("Transfer"), button[type="submit"]'
      ).last().click();
      await page.waitForTimeout(3_000);

      console.log(`[SGTransfer] Forwarded Sec ${section} Row ${row} Seat ${seat} → ${buyerEmail}`);

      // Return to tickets list for next seat
      if (seats.length > 1) {
        await page.goto("https://seatgeek.com/account/tickets", { waitUntil: "networkidle", timeout: 20_000 });
        await page.waitForTimeout(1_000);
      }
    }

    await page.close();
    return { success: true, message: `Transferred ${seats.length} ticket(s) to ${buyerEmail}` };
  } catch (err: any) {
    console.error("[SGTransfer] Error:", err.message);
    return { success: false, message: err.message };
  } finally {
    await close();
  }
}
