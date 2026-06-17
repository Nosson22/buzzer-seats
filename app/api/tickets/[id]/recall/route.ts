/**
 * POST /api/tickets/:id/recall
 *
 * In the new Pre-Listed Draft model there is no "recall" — the seller
 * simply cancels their DRAFT before it ever goes live, or they let it
 * expire naturally after the game window closes.
 *
 * This endpoint now delegates to cancelDraftListing for DRAFT listings.
 * It returns 410 Gone for LIVE/SOLD/EXPIRED listings.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cancelDraftListing } from "@/services/draft.service";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: listingId } = await params;

  try {
    await cancelDraftListing(listingId, session.user.id);
    return NextResponse.json({ success: true, message: "Draft listing cancelled and deleted." });
  } catch (err: any) {
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
    };
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: statusMap[err.code] ?? 500 }
    );
  }
}
