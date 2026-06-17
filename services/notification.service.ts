/**
 * Notification Service — Phase 2: T-60 Transfer Alert
 *
 * Called by the BullMQ notification worker when the scheduled job fires.
 * Sends a high-priority SMS via Twilio and a backup email via Resend
 * telling the seller to forward their ticket to deposits@buzzerseats.com NOW.
 *
 * Twilio env vars required:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER   (e.g. +13055550000)
 */
import { prisma } from "../lib/prisma";
import { CUSTODY_INBOUND_EMAIL } from "../lib/team-config";
import { sendTransferAlertEmail } from "../lib/email";

export async function sendTransferNowAlert(
  listingId: string,
  sellerId: string
): Promise<void> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      status: true,
      section: true,
      row: true,
      seatNumbers: true,
      liveTriggerType: true,
      game: {
        select: {
          homeTeam: true,
          awayTeam: true,
          gameTime: true,
        },
      },
      seller: {
        select: {
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  if (!listing) return;
  // If the listing is already LIVE or beyond, nothing to do
  if (listing.status !== "DRAFT") return;

  const { seller, game } = listing;

  const triggerLabel: Record<string, string> = {
    T_60: "60 minutes before first pitch",
    T_30: "30 minutes before first pitch",
    POST_START: "at first pitch",
  };

  const message = [
    `⚡ BUZZER SEATS ALERT`,
    `Your ticket listing for ${game.awayTeam} @ ${game.homeTeam} goes live in 30 minutes.`,
    `To activate it, open the MLB Ballpark app and forward your ticket to: ${CUSTODY_INBOUND_EMAIL}`,
    `If you've already sold your ticket elsewhere, ignore this message.`,
  ].join("\n");

  // --- SMS via Twilio (best-effort; don't throw if unconfigured) ---
  if (seller.phone && process.env.TWILIO_ACCOUNT_SID) {
    try {
      const twilio = require("twilio")(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      await twilio.messages.create({
        body: message,
        from: process.env.TWILIO_FROM_NUMBER,
        to: seller.phone,
      });
    } catch (err: any) {
      console.error("[NotificationService] Twilio SMS failed:", err.message);
    }
  }

  // --- Email fallback (always send) ---
  await sendTransferAlertEmail({
    to: seller.email,
    sellerName: seller.name,
    game: `${game.awayTeam} at ${game.homeTeam}`,
    gameTime: game.gameTime,
    section: listing.section,
    row: listing.row,
    seatNumbers: listing.seatNumbers,
    triggerType: listing.liveTriggerType,
    custodyEmail: CUSTODY_INBOUND_EMAIL,
  });

  // Record that notification was sent
  await prisma.listing.update({
    where: { id: listingId },
    data: { notificationSentAt: new Date() },
  });
}
