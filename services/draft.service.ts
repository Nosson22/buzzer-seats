/**
 * Draft Service — Phase 1: Pre-Listed Draft Stage
 *
 * The seller fills out game, section, row, seat, and price days in advance.
 * The listing is created as DRAFT — completely hidden from buyers.
 * The seller keeps their ticket in the MLB Ballpark app.
 *
 * A BullMQ notification job is scheduled to fire 30 minutes before their
 * chosen live-trigger, prompting them to forward the ticket to us.
 */
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { scheduleTransferNotification } from "../lib/queue/notification.queue";
import type { LiveTriggerType } from "@prisma/client";

export const createDraftSchema = z.object({
  gameId: z.string().cuid(),
  section: z.string().min(1).max(20),
  row: z.string().min(1).max(10),
  seatNumbers: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
  askingPrice: z.number().positive(),
  description: z.string().max(500).optional(),
  barcodeNumber: z.string().min(1).max(100),
  liveTriggerType: z.enum(["T_60", "T_30", "POST_START"]).default("T_60"),
  mlbTransferLink: z.string().max(2000).optional(),
});

export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export async function createDraftListing(
  input: CreateDraftInput,
  sellerId: string
) {
  const data = createDraftSchema.parse(input);

  const game = await prisma.game.findUnique({
    where: { id: data.gameId },
    select: { id: true, gameTime: true, status: true },
  });

  if (!game) {
    throw Object.assign(new Error("Game not found"), { code: "NOT_FOUND" });
  }
  if (game.status === "FINISHED" || game.status === "CANCELLED") {
    throw Object.assign(new Error("Game is not accepting listings"), { code: "GAME_UNAVAILABLE" });
  }
  if (game.gameTime <= new Date()) {
    throw Object.assign(new Error("Cannot list a ticket after game time"), { code: "GAME_STARTED" });
  }

  // Create the listing in DRAFT state — no job ID yet
  const listing = await prisma.listing.create({
    data: {
      sellerId,
      gameId: data.gameId,
      section: data.section,
      row: data.row,
      seatNumbers: data.seatNumbers,
      quantity: data.quantity,
      askingPrice: data.askingPrice,
      description: data.description,
      barcodeNumber: data.barcodeNumber,
      liveTriggerType: data.liveTriggerType as LiveTriggerType,
      mlbTransferLink: data.mlbTransferLink,
      status: "DRAFT",
    },
  });

  // Schedule the notification job non-blocking — don't let Redis issues block listing creation
  scheduleTransferNotification(
    listing.id,
    sellerId,
    data.gameId,
    data.liveTriggerType as LiveTriggerType,
    game.gameTime
  ).then(async (jobId) => {
    await prisma.listing.update({
      where: { id: listing.id },
      data: { notificationJobId: jobId },
    });
  }).catch((e) => console.error("[Draft] Failed to schedule notification:", e.message));

  return listing;
}

/** Cancel a draft and its pending notification job. */
export async function cancelDraftListing(listingId: string, sellerId: string) {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, sellerId, status: "DRAFT" },
    select: { id: true, notificationJobId: true },
  });

  if (!listing) {
    throw Object.assign(new Error("Draft listing not found"), { code: "NOT_FOUND" });
  }

  if (listing.notificationJobId) {
    const { cancelTransferNotification } = await import("../lib/queue/notification.queue");
    await cancelTransferNotification(listing.notificationJobId);
  }

  return prisma.listing.delete({ where: { id: listingId } });
}
