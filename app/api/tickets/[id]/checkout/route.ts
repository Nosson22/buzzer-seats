/**
 * POST /api/tickets/:id/checkout
 *
 * Buyer initiates a purchase. This creates a Stripe PaymentIntent AND acquires
 * the checkout lock on the listing row so simultaneous recall or double-purchase
 * cannot happen.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import {
  lockAndStartCheckout,
  LockConflictError,
  CheckoutActiveError,
} from "@/lib/db/ticket.repository";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: listingId } = await params;

  // Fetch listing to get price and game info
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { game: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  // Create Stripe PaymentIntent first (outside the DB transaction)
  // so we have a PI ID to store in the CheckoutSession.
  let paymentIntentId: string;
  let clientSecret: string;
  try {
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(listing.askingPrice * 100),
      currency: "usd",
      metadata: { listingId, buyerId: session.user.id, sellerId: listing.sellerId },
      description: `Buzzer Seats: ${listing.game.awayTeam} at ${listing.game.homeTeam} — Sec ${listing.section} Row ${listing.row}`,
    });
    paymentIntentId = pi.id;
    clientSecret = pi.client_secret!;
  } catch (err: any) {
    console.error("[Checkout] Stripe PI creation failed:", err.message);
    return NextResponse.json({ error: "Payment setup failed" }, { status: 502 });
  }

  // Now lock the listing row and create the checkout session atomically
  try {
    const { session: checkoutSession, expiresAt } = await lockAndStartCheckout(
      listingId,
      session.user.id,
      paymentIntentId
    );

    return NextResponse.json({
      clientSecret,
      checkoutSessionId: checkoutSession.id,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err: unknown) {
    // Cancel the Stripe PI we already created — don't leave orphans
    await stripe.paymentIntents.cancel(paymentIntentId).catch(() => {});

    if (err instanceof CheckoutActiveError) {
      return NextResponse.json(
        {
          error: "Another buyer is currently checking out this ticket.",
          code: "CHECKOUT_ACTIVE",
          retryAfter: err.checkoutExpiresAt,
        },
        { status: 409 }
      );
    }
    if (err instanceof LockConflictError) {
      return NextResponse.json(
        { error: "Transient conflict — please retry.", code: "LOCK_CONFLICT" },
        { status: 423 }
      );
    }

    const e = err as any;
    if (e?.code === "NOT_AVAILABLE") {
      return NextResponse.json(
        { error: `Ticket is no longer available (status: ${e.currentStatus})` },
        { status: 409 }
      );
    }

    console.error("[Checkout] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
