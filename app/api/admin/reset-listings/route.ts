import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "buzzer-admin-2026";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await prisma.listing.updateMany({
    where: { status: "LIVE" },
    data: { status: "DRAFT", activatedAt: null, custodyTransferredAt: null, custodyEmail: null },
  });
  return NextResponse.json({ reset: result.count });
}
