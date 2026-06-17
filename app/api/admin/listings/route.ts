import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/admin/listings — all listings with verification status
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const verificationStatus = searchParams.get("verificationStatus");
  const status = searchParams.get("status");

  const listings = await prisma.listing.findMany({
    where: {
      ...(verificationStatus ? { verificationStatus: verificationStatus as any } : {}),
      ...(status ? { status: status as any } : {}),
    },
    include: {
      seller: { select: { id: true, name: true, email: true } },
      game: { include: { team: true } },
      _count: { select: { bids: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(listings);
}
