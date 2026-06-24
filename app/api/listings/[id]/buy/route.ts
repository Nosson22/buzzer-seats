import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scheduleTransferToBuyer } from "@/lib/queue/mlb-automation.queue";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: params.id },
    include: { seller: { select: { id: true, email: true } } },
  });

  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  if (listing.status !== "LIVE") {
    return NextResponse.json({ error: "Listing is not available for purchase" }, { status: 400 });
  }
  if (listing.sellerId === session.user.id) {
    return NextResponse.json({ error: "You cannot buy your own listing" }, { status: 400 });
  }

  const commissionRate = parseFloat(process.env.COMMISSION_RATE ?? "0.15");
  const salePrice = listing.askingPrice * listing.quantity;
  const commissionAmount = salePrice * commissionRate;
  const sellerPayout = salePrice - commissionAmount;

  // Mark listing SOLD and create transaction atomically
  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listing.id },
      data: { status: "SOLD", closedAt: new Date() },
    }),
    prisma.transaction.create({
      data: {
        listingId: listing.id,
        buyerId: session.user.id,
        sellerId: listing.sellerId,
        salePrice,
        commissionRate,
        commissionAmount,
        sellerPayout,
        status: "COMPLETED",
      },
    }),
  ]);

  // Queue Device Farm job to transfer ticket to buyer
  await scheduleTransferToBuyer(listing.id, session.user.email!);

  return NextResponse.json({ ok: true, listingId: listing.id });
}
