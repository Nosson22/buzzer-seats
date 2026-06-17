import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe, calcAmounts } from "@/lib/stripe";
import { isInBuyingWindow } from "@/lib/game-windows";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bid = await prisma.bid.findUnique({
    where: { id },
    include: { listing: { include: { game: true, seller: true } }, bidder: true },
  });

  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.listing.sellerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (bid.listing.status !== "LIVE") {
    return NextResponse.json({ error: "Listing is no longer available" }, { status: 400 });
  }
  if (!isInBuyingWindow(bid.listing.game.gameTime)) {
    return NextResponse.json({ error: "Buying window has closed" }, { status: 400 });
  }
  if (bid.status !== "PENDING") {
    return NextResponse.json({ error: "Bid is no longer pending" }, { status: 400 });
  }

  const { commissionAmount, sellerPayout } = calcAmounts(bid.amount);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(bid.amount * 100),
    currency: "usd",
    metadata: {
      bidId: bid.id,
      listingId: bid.listingId,
      buyerId: bid.bidderId,
      sellerId: bid.listing.sellerId,
    },
    description: `Buzzer Seats: ${bid.listing.game.homeTeam} vs ${bid.listing.game.awayTeam} — Sec ${bid.listing.section} Row ${bid.listing.row}`,
  });

  await prisma.$transaction([
    prisma.bid.update({ where: { id: bid.id }, data: { status: "ACCEPTED" } }),
    prisma.bid.updateMany({
      where: { listingId: bid.listingId, id: { not: bid.id }, status: "PENDING" },
      data: { status: "REJECTED" },
    }),
    prisma.listing.update({
      where: { id: bid.listingId },
      data: { status: "SOLD", closedAt: new Date() },
    }),
    prisma.transaction.create({
      data: {
        listingId: bid.listingId,
        bidId: bid.id,
        buyerId: bid.bidderId,
        sellerId: bid.listing.sellerId,
        salePrice: bid.amount,
        commissionAmount,
        sellerPayout,
        stripePaymentIntentId: paymentIntent.id,
        status: "PENDING",
      },
    }),
  ]);

  return NextResponse.json({ clientSecret: paymentIntent.client_secret });
}
