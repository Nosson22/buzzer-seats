/**
 * GET /api/cron/activate-listings
 *
 * Fallback safety-net cron (runs every minute via Vercel Cron).
 * The primary path is BullMQ notification jobs + inbound email custody.
 * This cron only cleans up stale state:
 *   - Marks LIVE tickets EXPIRED if the game started > team-offset minutes ago
 *   - Marks finished games FINISHED
 *
 * Protected by CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Expire LIVE listings for games that started more than 30 minutes ago
  // (conservative fallback — BullMQ expiry worker handles the precise timing per team)
  const expiredResult = await prisma.listing.updateMany({
    where: {
      status: "LIVE",
      game: { gameTime: { lte: new Date(now.getTime() - 30 * 60 * 1_000) } },
    },
    data: { status: "EXPIRED", closedAt: now },
  });

  // Mark games as FINISHED
  await prisma.game.updateMany({
    where: { gameTime: { lte: now }, status: { in: ["UPCOMING", "LIVE"] } },
    data: { status: "FINISHED" },
  });

  return NextResponse.json({ expired: expiredResult.count, timestamp: now.toISOString() });
}
