import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== (process.env.ADMIN_SECRET ?? "buzzer-admin-2026")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { Queue } = await import("bullmq");
    const { workerConnection } = await import("@/lib/queue/redis");

    const queue = new Queue("mlb-automation", { connection: workerConnection });

    const [waiting, active, failed, delayed, counts] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getFailed(),
      queue.getDelayed(),
      queue.getJobCounts(),
    ]);

    await queue.close();

    return NextResponse.json({
      counts,
      waiting: waiting.map(j => ({ id: j.id, data: j.data, attempts: j.attemptsMade })),
      active: active.map(j => ({ id: j.id, data: j.data })),
      delayed: delayed.map(j => ({ id: j.id, data: j.data, attempts: j.attemptsMade, nextRun: j.delay })),
      failed: failed.slice(0, 5).map(j => ({ id: j.id, data: j.data, reason: j.failedReason })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
