import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as any;
    const { listingId, buyerId, sellerId } = pi.metadata;
    if (!listingId) return NextResponse.json({ received: true });

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { seller: { select: { stripeAccountId: true } } },
    });
    if (!listing) return NextResponse.json({ received: true });

    const salePrice = pi.amount / 100;
    const commissionAmount = parseFloat((salePrice * 0.15).toFixed(2));
    const sellerPayout = parseFloat((salePrice - commissionAmount).toFixed(2));

    // Transfer seller's cut to their Connect account
    if (listing.seller.stripeAccountId) {
      await stripe.transfers.create({
        amount: Math.round(sellerPayout * 100),
        currency: "usd",
        destination: listing.seller.stripeAccountId,
        transfer_group: listingId,
      });
    }

    // Cancel the expiry job — listing is sold, no need to expire
    if (listing.expiryJobId) {
      const { cancelExpiry } = await import("@/lib/queue/expiry.queue");
      cancelExpiry(listing.expiryJobId).catch(() => {});
    }

    // Atomically flip LIVE → SOLD and record the transaction
    await prisma.$transaction([
      prisma.listing.update({
        where: { id: listingId },
        data: { status: "SOLD", closedAt: new Date(), activeCheckoutSessionId: null },
      }),
      prisma.transaction.upsert({
        where: { listingId },
        update: { status: "COMPLETED" },
        create: {
          listingId,
          buyerId,
          sellerId,
          salePrice,
          commissionAmount,
          sellerPayout,
          stripePaymentIntentId: pi.id,
          status: "COMPLETED",
        },
      }),
    ]);
  }

  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as any;
    const { listingId } = pi.metadata;
    if (listingId) {
      // Release checkout lock so the listing is purchasable again
      await prisma.listing.updateMany({
        where: { id: listingId, status: "LIVE" },
        data: { activeCheckoutSessionId: null },
      });
    }
  }

  return NextResponse.json({ received: true });
}
