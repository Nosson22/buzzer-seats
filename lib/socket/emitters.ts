/**
 * Typed emitter helpers.
 * Call these from services — they look up the global io instance
 * so they work both inside the custom server and inside API routes
 * that run in the same process.
 */
import { getIO } from "./server";
import {
  SOCKET_ROOMS,
  ListingAvailablePayload,
  ListingRecalledPayload,
  ListingSoldPayload,
  RecallConfirmedPayload,
} from "./events";

export function emitListingAvailable(gameId: string, payload: ListingAvailablePayload): void {
  const io = getIO();
  if (!io) return;
  io.to(SOCKET_ROOMS.game(gameId)).emit("listing:available", payload);
}

/**
 * Broadcasts an instant delist to every buyer currently viewing the game feed.
 * Called by recallService immediately after the DB row is flipped to RECALLED,
 * so a buyer's UI removes the card within a single network round-trip.
 */
export function emitListingRecalled(gameId: string, payload: ListingRecalledPayload): void {
  const io = getIO();
  if (!io) return;
  io.to(SOCKET_ROOMS.game(gameId)).emit("listing:recalled", payload);
}

export function emitListingSold(gameId: string, payload: ListingSoldPayload): void {
  const io = getIO();
  if (!io) return;
  io.to(SOCKET_ROOMS.game(gameId)).emit("listing:sold", payload);
}

/** Notify the seller's private channel that their recall succeeded. */
export function emitRecallConfirmed(sellerId: string, payload: RecallConfirmedPayload): void {
  const io = getIO();
  if (!io) return;
  io.to(SOCKET_ROOMS.seller(sellerId)).emit("recall:confirmed", payload);
}
