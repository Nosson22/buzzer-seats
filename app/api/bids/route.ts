import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { isInBuyingWindow } from "@/lib/game-windows";

const bidSchema = z.object({
  listingId: z.string(),
  amount: z.number().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { listingId, amount } = bidSchema.parse(body);

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { game: true },
    });

    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    if (listing.status !== "LIVE") {
      return NextResponse.json({ error: "Listing is not open for bids" }, { status: 400 });
    }
    if (!isInBuyingWindow(listing.game.gameTime)) {
      return NextResponse.json({ error: "Buying window is closed" }, { status: 400 });
    }
    if (listing.sellerId === session.user.id) {
      return NextResponse.json({ error: "Cannot bid on your own listing" }, { status: 400 });
    }
    if (amount < listing.askingPrice) {
      return NextResponse.json(
        { error: `Bid must be at least ${listing.askingPrice}` },
        { status: 400 }
      );
    }

    const bid = await prisma.bid.create({
      data: { listingId, bidderId: session.user.id, amount },
    });

    return NextResponse.json(bid, { status: 201 });
  } catch (err: any) {
    if (err.name === "ZodError") return NextResponse.json({ error: err.errors }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const listingId = searchParams.get("listingId");
  const mine = searchParams.get("mine") === "true";

  const where: any = {};
  if (listingId) where.listingId = listingId;
  if (mine) where.bidderId = session.user.id;

  const bids = await prisma.bid.findMany({
    where,
    include: {
      listing: { include: { game: { include: { team: true } } } },
      bidder: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(bids);
}
