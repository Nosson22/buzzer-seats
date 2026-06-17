/**
 * Ticket Repository
 *
 * All database mutations on Listing rows that require race-condition safety
 * use PostgreSQL's `SELECT … FOR UPDATE NOWAIT` inside a serializable
 * transaction. A concurrent lock holder causes an immediate throw rather
 * than blocking — callers receive a typed `LockConflictError`.
 */
import { prisma } from "../prisma";
import { Prisma, TicketStatus } from "@prisma/client";

// ── Typed errors ─────────────────────────────────────────────────────────────

export class LockConflictError extends Error {
  readonly code = "LOCK_CONFLICT";
  constructor(public readonly listingId: string) {
    super(`Row lock conflict on listing ${listingId}`);
    this.name = "LockConflictError";
  }
}

export class ListingNotLiveError extends Error {
  readonly code = "LISTING_NOT_LIVE";
  constructor(public readonly listingId: string, public readonly currentStatus: string) {
    super(`Listing ${listingId} is ${currentStatus}, expected LIVE`);
    this.name = "ListingNotLiveError";
  }
}

export class CheckoutActiveError extends Error {
  readonly code = "CHECKOUT_ACTIVE";
  constructor(public readonly listingId: string, public readonly checkoutExpiresAt: Date) {
    super(`Listing ${listingId} has an active checkout until ${checkoutExpiresAt.toISOString()}`);
    this.name = "CheckoutActiveError";
  }
}

const PG_LOCK_NOT_AVAILABLE = "55P03";

function isLockError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.meta as any)?.code === PG_LOCK_NOT_AVAILABLE
  );
}

// ── Checkout: start ──────────────────────────────────────────────────────────

/**
 * Atomically lock a LIVE listing and open a buyer checkout session.
 * Fails if status isn't LIVE or a checkout is already active.
 */
export async function lockAndStartCheckout(
  listingId: string,
  buyerId: string,
  stripePaymentIntentId: string,
  ttlMs = 15 * 60 * 1_000
) {
  return prisma
    .$transaction(
      async (tx) => {
        const rows: Array<{
          id: string;
          status: TicketStatus;
          active_checkout_session_id: string | null;
        }> = await tx.$queryRaw`
          SELECT id, status, active_checkout_session_id
          FROM listings WHERE id = ${listingId}
          FOR UPDATE NOWAIT
        `;

        if (!rows.length) throw new Error(`Listing ${listingId} not found`);
        const r = rows[0];

        if (r.status !== "LIVE") {
          throw Object.assign(
            new Error(`Listing is ${r.status}, not available for purchase`),
            { code: "NOT_LIVE", currentStatus: r.status }
          );
        }

        if (r.active_checkout_session_id) {
          const existing = await tx.checkoutSession.findUnique({
            where: { id: r.active_checkout_session_id },
            select: { expiresAt: true, completedAt: true, cancelledAt: true },
          });
          if (
            existing &&
            !existing.completedAt &&
            !existing.cancelledAt &&
            existing.expiresAt > new Date()
          ) {
            throw new CheckoutActiveError(listingId, existing.expiresAt);
          }
        }

        const expiresAt = new Date(Date.now() + ttlMs);
        const session = await tx.checkoutSession.create({
          data: { buyerId, stripePaymentIntentId, expiresAt },
        });

        await tx.listing.update({
          where: { id: listingId },
          data: { activeCheckoutSessionId: session.id },
        });

        return { session, expiresAt };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 5_000 }
    )
    .catch((err) => {
      if (isLockError(err)) throw new LockConflictError(listingId);
      throw err;
    });
}

// ── Checkout: complete (payment succeeded) ───────────────────────────────────

/**
 * Mark checkout complete and flip LIVE → SOLD.
 * Idempotent — if already SOLD returns null (Stripe webhook may fire twice).
 */
export async function lockAndCompleteSale(listingId: string) {
  return prisma
    .$transaction(
      async (tx) => {
        const rows: Array<{
          id: string;
          status: TicketStatus;
          active_checkout_session_id: string | null;
          game_id: string;
        }> = await tx.$queryRaw`
          SELECT id, status, active_checkout_session_id, game_id
          FROM listings WHERE id = ${listingId}
          FOR UPDATE NOWAIT
        `;

        if (!rows.length) throw new Error(`Listing ${listingId} not found`);
        const r = rows[0];

        if (r.status === "SOLD") return null; // idempotent

        if (r.active_checkout_session_id) {
          await tx.checkoutSession.update({
            where: { id: r.active_checkout_session_id },
            data: { completedAt: new Date() },
          });
        }

        return tx.listing.update({
          where: { id: listingId },
          data: { status: "SOLD", closedAt: new Date(), activeCheckoutSessionId: null },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 5_000 }
    )
    .catch((err) => {
      if (isLockError(err)) throw new LockConflictError(listingId);
      throw err;
    });
}
