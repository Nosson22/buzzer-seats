import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { scheduleTestTMLogin } from "@/lib/queue/ticket-automation.queue";
import { prisma } from "@/lib/prisma";

const PING_KEY = "test-tm-login";

// POST — enqueue a test login job in the worker
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Clear any stale result so GET polling starts fresh
  await prisma.workerPing.deleteMany({ where: { key: PING_KEY } });

  await scheduleTestTMLogin();

  return NextResponse.json({ queued: true, message: "Test job queued — poll GET to check result" });
}

// GET — poll for the result written by the worker
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ping = await prisma.workerPing.findUnique({ where: { key: PING_KEY } });
  if (!ping) {
    return NextResponse.json({ pending: true });
  }

  return NextResponse.json({ pending: false, ok: ping.ok, message: ping.message, elapsedMs: ping.elapsedMs });
}
