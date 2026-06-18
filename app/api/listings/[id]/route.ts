import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      seller: { select: { id: true, name: true } },
      game: { include: { team: true } },
      bids: {
        where: { status: "PENDING" },
        include: { bidder: { select: { id: true, name: true } } },
        orderBy: { amount: "desc" },
      },
    },
  });

  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(listing);
}

// PATCH /api/listings/:id
// Sellers can cancel their own DRAFT (before notification fires).
// Admins can force-expire or force-cancel any listing.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      id: true,
      sellerId: true,
      status: true,
      notificationJobId: true,
      expiryJobId: true,
    },
  });
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.user.role === "ADMIN";
  const isSeller = listing.sellerId === session.user.id;

  if (!isAdmin && !isSeller) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();

  // Seller cancels their DRAFT before it goes live
  if (isSeller && body.action === "cancel_draft") {
    if (listing.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Only DRAFT listings can be cancelled by the seller" },
        { status: 400 }
      );
    }

    const { cancelDraftListing } = await import("@/services/draft.service");
    await cancelDraftListing(id, session.user.id);
    return NextResponse.json({ ok: true, deleted: true });
  }

  // Admin force-expire a LIVE listing (e.g. if there's a problem)
  if (isAdmin && body.action === "force_expire") {
    if (listing.status !== "LIVE") {
      return NextResponse.json({ error: "Listing is not LIVE" }, { status: 400 });
    }

    const { expireListing } = await import("@/services/expiry.service");
    await expireListing(id);

    // Cancel the scheduled expiry job since we just ran it manually
    if (listing.expiryJobId) {
      const { cancelExpiry } = await import("@/lib/queue/expiry.queue");
      await cancelExpiry(listing.expiryJobId).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  }

  // Admin verifies (approves or rejects) a listing
  if (isAdmin && (body.verificationStatus === "APPROVED" || body.verificationStatus === "REJECTED")) {
    await prisma.listing.update({
      where: { id },
      data: {
        verificationStatus: body.verificationStatus,
        verificationNote: body.verificationNote ?? null,
      },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
