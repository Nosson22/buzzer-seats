import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      _count: {
        select: {
          listings: true,
          bids: true,
          buyerTransactions: true,
          sellerTransactions: true,
        },
      },
      listings: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          verificationStatus: true,
          askingPrice: true,
          section: true,
          row: true,
          seatNumbers: true,
          quantity: true,
          createdAt: true,
          game: { select: { awayTeam: true, homeTeam: true, gameTime: true } },
        },
      },
    },
  });

  return NextResponse.json(users);
}
