import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [users, listings, transactions, pendingVerification] = await Promise.all([
    prisma.user.count(),
    prisma.listing.groupBy({ by: ["status"], _count: true }),
    prisma.transaction.aggregate({
      where: { status: "COMPLETED" },
      _sum: { salePrice: true, commissionAmount: true },
      _count: true,
    }),
    prisma.listing.count({ where: { status: "DRAFT" } }),
  ]);

  return NextResponse.json({
    totalUsers: users,
    listings,
    completedSales: transactions._count,
    totalRevenue: transactions._sum.salePrice ?? 0,
    totalCommission: transactions._sum.commissionAmount ?? 0,
    pendingVerification,
  });
}
