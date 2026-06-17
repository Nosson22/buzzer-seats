/**
 * POST /api/tickets — alias for POST /api/listings (backward compat)
 * Delegates to the draft service.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createDraftListing, createDraftSchema } from "@/services/draft.service";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "BUYER") {
    return NextResponse.json({ error: "Only sellers can create listings" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const listing = await createDraftListing(body as any, session.user.id);
    return NextResponse.json(listing, { status: 201 });
  } catch (err: any) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation error", details: err.errors }, { status: 400 });
    }
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      GAME_UNAVAILABLE: 409,
      GAME_STARTED: 409,
    };
    return NextResponse.json({ error: err.message }, { status: statusMap[err.code] ?? 500 });
  }
}
