/**
 * Stripe webhook handler.
 *
 * payment_intent.succeeded  → lockAndCompleteSale → emit listing:sold
 * payment_intent.payment_failed → release checkout lock, reopen listing
 */
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { lockAndCompleteSale, LockConflictError } from "@/lib/db/ticket.repository";
import { emitListingSold } from "@/lib/socket/emitters";
import { calcAmounts } from "@/lib/stripe";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  // ── payment_intent.succeeded ───────────────────────────────────────────────
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const { listingId, buyerId, sellerId } = pi.metadata as {
      listingId: string;
      buyerId: string;
      sellerId: string;
    };
    if (!listingId) return NextResponse.json({ received: true });

    try {
      const updated = await lockAndCompleteSale(listingId);
      if (!updated) return NextResponse.json({ received: true }); // idempotent

      const { commissionAmount, sellerPayout } = calcAmounts(updated.askingPrice);

      await prisma.transaction.upsert({
        where: { listingId },
        create: {
          listingId,
          buyerId,
          sellerId,
          salePrice: updated.askingPrice,
          commissionAmount,
          sellerPayout,
          stripePaymentIntentId: pi.id,
          status: "COMPLETED",
        },
        update: { status: "COMPLETED" },
      });

      emitListingSold(updated.gameId, {
        listingId: updated.id,
        gameId: updated.gameId,
        soldAt: updated.closedAt!.toISOString(),
      });
    } catch (err: unknown) {
      if (err instanceof LockConflictError) {
        // Stripe will retry — we haven't returned 200 yet
        console.error("[Webhook] Lock conflict on sale:", listingId);
        return NextResponse.json({ error: "Transient lock" }, { status: 503 });
      }
      console.error("[Webhook] payment_intent.succeeded error:", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  // ── payment_intent.payment_failed ─────────────────────────────────────────
  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const { listingId } = pi.metadata as { listingId?: string };
    if (!listingId) return NextResponse.json({ received: true });

    // Release the checkout lock and reopen the listing
    await prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        select: { activeCheckoutSessionId: true, status: true },
      });
      if (!listing || listing.status === "SOLD" || listing.status === "EXPIRED") return;

      if (listing.activeCheckoutSessionId) {
        await tx.checkoutSession.update({
          where: { id: listing.activeCheckoutSessionId },
          data: { cancelledAt: new Date() },
        });
      }

      await tx.listing.update({
        where: { id: listingId },
        data: { activeCheckoutSessionId: null },
        // listing stays AVAILABLE; buyer can try again or seller can recall
      });
    });
  }

  return NextResponse.json({ received: true });
}
