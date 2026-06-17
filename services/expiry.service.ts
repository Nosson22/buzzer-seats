/**
 * Expiry Service — Phase 4: Post-Start Auto-Expire
 *
 * Called by the BullMQ expiry worker when the scheduled job fires.
 * If the listing is still LIVE (unsold), flips it to EXPIRED and
 * emails the seller a link to reclaim their ticket from our account.
 */
import { prisma } from "../lib/prisma";
import { sendTicketReturnEmail } from "../lib/email";

export async function expireListing(listingId: string): Promise<void> {
  // Atomically flip LIVE → EXPIRED using updateMany (only succeeds if still LIVE)
  const result = await prisma.listing.updateMany({
    where: { id: listingId, status: "LIVE" },
    data: { status: "EXPIRED", closedAt: new Date() },
  });

  if (result.count === 0) {
    // Already sold or previously expired — treat as clean no-op
    throw Object.assign(new Error("Listing was not LIVE"), { code: "LISTING_NOT_LIVE" });
  }

  // Fetch full listing data for the return email
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      section: true,
      row: true,
      seatNumbers: true,
      mlbTransferLink: true,
      custodyEmail: true,
      seller: { select: { name: true, email: true } },
      game: {
        select: {
          homeTeam: true,
          awayTeam: true,
          gameTime: true,
        },
      },
    },
  });

  if (!listing) return;

  // Email seller so they can recover their ticket from our account
  sendTicketReturnEmail({
    to: listing.seller.email,
    sellerName: listing.seller.name,
    game: `${listing.game.awayTeam} at ${listing.game.homeTeam}`,
    section: listing.section,
    row: listing.row,
    seatNumbers: listing.seatNumbers,
    mlbTransferLink: listing.mlbTransferLink ?? undefined,
  }).catch((e) => console.error("[ExpiryService] Return email failed:", e.message));
}
