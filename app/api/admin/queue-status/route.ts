import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== (process.env.ADMIN_SECRET ?? "buzzer-admin-2026")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redisUrl = process.env.REDIS_URL ?? "(not set)";
  const redisHost = process.env.REDIS_HOST ?? "(not set)";

  try {
    const { Queue } = await import("bullmq");
    const IORedis = (await import("ioredis")).default;

    const redisOpts = redisUrl !== "(not set)"
      ? { host: new URL(redisUrl).hostname, port: parseInt(new URL(redisUrl).port || "6379"), password: new URL(redisUrl).password || undefined, maxRetriesPerRequest: null as null }
      : { host: redisHost, port: 6379, maxRetriesPerRequest: null as null };

    const queue = new Queue("mlb-automation", { connection: redisOpts });
    const counts = await queue.getJobCounts();
    const failed = await queue.getFailed(0, 4);
    const delayed = await queue.getDelayed(0, 4);
    await queue.close();

    return NextResponse.json({
      redisConnected: true,
      redisHost: redisOpts.host,
      counts,
      failed: failed.map(j => ({ id: j.id, data: j.data, reason: j.failedReason })),
      delayed: delayed.map(j => ({ id: j.id, data: j.data, attempts: j.attemptsMade })),
    });
  } catch (err: any) {
    return NextResponse.json({
      redisConnected: false,
      redisUrl: redisUrl.replace(/:[^:@]+@/, ":***@"),
      error: err.message,
    }, { status: 500 });
  }
}
