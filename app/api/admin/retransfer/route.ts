import { NextRequest, NextResponse } from "next/server";
import { scheduleTransferToBuyer } from "@/lib/queue/mlb-automation.queue";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { listingId, buyerEmail } = await req.json();
  await scheduleTransferToBuyer(listingId, buyerEmail);
  return NextResponse.json({ ok: true });
}
