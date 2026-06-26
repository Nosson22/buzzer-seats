import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { status } = await req.json();
  if (!["LIVE", "DRAFT"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const now = new Date();
  const listing = await prisma.listing.update({
    where: { id: params.id },
    data: {
      status,
      ...(status === "LIVE" ? { activatedAt: now } : { activatedAt: null, custodyTransferredAt: null, custodyEmail: null }),
    },
  });

  return NextResponse.json({ ok: true, listing });
}
