import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/listings
// Buyers see only LIVE listings for a game.
// Sellers see their own listings in any status.
// Admins see everything.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const gameId = searchParams.get("gameId");
  const sellerId = searchParams.get("sellerId");

  const session = await getServerSession(authOptions);
  const isAdmin = session?.user?.role === "ADMIN";
  const isSeller = session?.user?.role === "SELLER" || isAdmin;

  const where: any = {};
  if (gameId) where.gameId = gameId;

  if (sellerId && (isAdmin || sellerId === session?.user?.id)) {
    // Seller viewing their own listings — show all statuses
    where.sellerId = sellerId;
  } else {
    // Buyer-facing marketplace — show only LIVE listings
    where.status = "LIVE";
  }

  const listings = await prisma.listing.findMany({
    where,
    include: {
      seller: { select: { id: true, name: true } },
      game: { include: { team: { select: { name: true, slug: true } } } },
      _count: { select: { bids: { where: { status: "PENDING" } } } },
    },
    orderBy: { askingPrice: "asc" },
  });

  return NextResponse.json(listings);
}

// POST /api/listings — create a new draft listing
const createDraftSchema = z.object({
  gameId: z.string().cuid(),
  section: z.string().min(1).max(20),
  row: z.string().min(1).max(10),
  seatNumbers: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
  askingPrice: z.number().min(1),
  description: z.string().max(500).optional(),
  barcodeNumber: z.string().min(1).max(100),
  liveTriggerType: z.enum(["T_60", "T_30", "POST_START"]).default("T_60"),
  mlbTransferLink: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "BUYER") {
    return NextResponse.json({ error: "Only sellers can create listings" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const data = createDraftSchema.parse(body);

    const game = await prisma.game.findUnique({
      where: { id: data.gameId },
      include: { team: true },
    });
    if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
    if (game.status === "FINISHED" || game.status === "CANCELLED") {
      return NextResponse.json({ error: "Cannot list tickets for this game" }, { status: 400 });
    }
    if (game.gameTime <= new Date()) {
      return NextResponse.json({ error: "Game has already started" }, { status: 400 });
    }

    // Create the DRAFT listing + schedule notification job
    const { createDraftListing } = await import("@/services/draft.service");
    const listing = await createDraftListing(data as any, session.user.id);

    // Non-blocking emails
    const seller = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true },
    });

    if (seller?.email) {
      const { sendDraftCreatedEmail, sendAdminNewListingEmail } = await import("@/lib/email");
      const { CUSTODY_INBOUND_EMAIL } = await import("@/lib/team-config");

      sendDraftCreatedEmail({
        to: seller.email,
        sellerName: seller.name,
        game: `${game.awayTeam} at ${game.homeTeam}`,
        section: data.section,
        row: data.row,
        seatNumbers: data.seatNumbers,
        askingPrice: data.askingPrice,
        triggerType: data.liveTriggerType,
        custodyEmail: CUSTODY_INBOUND_EMAIL,
      }).catch((e) => console.error("[Email] draft created:", e.message));

      sendAdminNewListingEmail({
        sellerName: seller.name,
        sellerEmail: seller.email,
        game: `${game.awayTeam} at ${game.homeTeam}`,
        section: data.section,
        row: data.row,
        seatNumbers: data.seatNumbers,
        askingPrice: data.askingPrice,
        barcodeNumber: data.barcodeNumber,
        listingId: listing.id,
      }).catch((e) => console.error("[Email] admin notify:", e.message));
    }

    return NextResponse.json(listing, { status: 201 });
  } catch (err: any) {
    if (err.name === "ZodError") return NextResponse.json({ error: err.errors }, { status: 400 });
    console.error("[POST /api/listings]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
