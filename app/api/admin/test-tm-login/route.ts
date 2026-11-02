import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTMAuthenticatedContext } from "@/lib/playwright/ticketmaster-session";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const start = Date.now();
  let result: { ok: boolean; message: string; elapsedMs?: number } = { ok: false, message: "" };

  try {
    const { close } = await getTMAuthenticatedContext("heat");
    const elapsedMs = Date.now() - start;
    await close();
    result = { ok: true, message: "Ticketmaster login successful", elapsedMs };
  } catch (err: any) {
    result = { ok: false, message: err?.message ?? "Unknown error", elapsedMs: Date.now() - start };
  }

  return NextResponse.json(result);
}
