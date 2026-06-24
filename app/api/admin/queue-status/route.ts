import { NextRequest, NextResponse } from "next/server";
import { mlbAutomationQueue } from "@/lib/queue/mlb-automation.queue";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== (process.env.ADMIN_SECRET ?? "buzzer-admin-2026")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [waiting, active, failed, delayed] = await Promise.all([
    mlbAutomationQueue.getWaiting(),
    mlbAutomationQueue.getActive(),
    mlbAutomationQueue.getFailed(),
    mlbAutomationQueue.getDelayed(),
  ]);
  return NextResponse.json({
    waiting: waiting.map(j => ({ id: j.id, data: j.data, attempts: j.attemptsMade })),
    active: active.map(j => ({ id: j.id, data: j.data })),
    delayed: delayed.map(j => ({ id: j.id, data: j.data, attempts: j.attemptsMade })),
    failed: failed.slice(0, 5).map(j => ({ id: j.id, data: j.data, reason: j.failedReason })),
  });
}
