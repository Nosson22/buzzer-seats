import { NextRequest, NextResponse } from "next/server";
import { scheduleTransferToBuyer, scheduleAcceptTransfer } from "@/lib/queue/mlb-automation.queue";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  const adminSecret = process.env.ADMIN_SECRET ?? "buzzer-admin-2026";
  if (secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { listingId, buyerEmail, jobType } = await req.json();
  if (jobType === "accept-transfer") {
    await scheduleAcceptTransfer(listingId);
  } else {
    await scheduleTransferToBuyer(listingId, buyerEmail);
  }
  return NextResponse.json({ ok: true });
}
