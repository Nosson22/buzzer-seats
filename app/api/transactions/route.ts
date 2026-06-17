import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = session.user.role === "ADMIN";
  const where = isAdmin
    ? {}
    : { OR: [{ buyerId: session.user.id }, { sellerId: session.user.id }] };

  const transactions = await prisma.transaction.findMany({
    where,
    include: {
      listing: {
        include: { game: { include: { team: true } } },
      },
      buyer: { select: { id: true, name: true, email: true } },
      seller: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(transactions);
}
