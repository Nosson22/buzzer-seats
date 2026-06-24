/**
 * POST /api/admin/accept-transfer
 *
 * Two modes:
 *   1. { acceptUrl } — directly click a known MLB accept URL via Playwright
 *   2. { } — poll Postmark inbound API for recent messages and process any unhandled ones
 *
 * This endpoint exists so we can:
 *   a) Handle the current pending transfer immediately (paste the accept URL)
 *   b) Re-process any emails that arrived before the Postmark webhook was configured
 */
import { NextRequest, NextResponse } from "next/server";
import { clickAcceptUrl, processCustodyEmail } from "@/services/custody.service";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "buzzer-admin-2026";
const POSTMARK_TOKEN = process.env.POSTMARK_SERVER_TOKEN;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // Mode 1a: skipClick — just mark the listing LIVE (for when seller accepted manually)
  if (body.skipClick && body.listingId) {
    const { prisma } = await import("@/lib/prisma");
    await prisma.listing.update({
      where: { id: body.listingId },
      data: { status: "LIVE", activatedAt: new Date() },
    });
    console.log("[ManualAccept] Marked listing LIVE (skipClick):", body.listingId);
    return NextResponse.json({ ok: true, listingId: body.listingId, status: "LIVE" });
  }

  // Mode 1b: direct URL click
  if (body.acceptUrl) {
    console.log("[ManualAccept] Clicking accept URL:", body.acceptUrl);
    const ok = await clickAcceptUrl(body.acceptUrl);
    if (!ok) return NextResponse.json({ ok: false, error: "Playwright click failed — check Railway logs" }, { status: 500 });

    // If a listingId is provided, mark it LIVE
    if (body.listingId) {
      const { prisma } = await import("@/lib/prisma");
      await prisma.listing.update({
        where: { id: body.listingId },
        data: { status: "LIVE", activatedAt: new Date() },
      });
      return NextResponse.json({ ok: true, listingId: body.listingId, status: "LIVE" });
    }

    return NextResponse.json({ ok: true, message: "Accept URL clicked successfully" });
  }

  // Mode 2: poll Postmark inbound API for recent messages
  if (!POSTMARK_TOKEN) {
    return NextResponse.json({
      ok: false,
      error: "POSTMARK_SERVER_TOKEN not set in Railway env vars. Add it and redeploy, or pass acceptUrl directly.",
    }, { status: 400 });
  }

  try {
    // Fetch the 50 most recent inbound messages from Postmark
    const res = await fetch("https://api.postmarkapp.com/messages/inbound?count=50&offset=0", {
      headers: { "X-Postmark-Server-Token": POSTMARK_TOKEN, "Accept": "application/json" },
    });
    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ ok: false, error: `Postmark API error: ${txt}` }, { status: 500 });
    }

    const data = await res.json();
    const messages = data.InboundMessages ?? [];
    const results: any[] = [];

    for (const msg of messages) {
      // Fetch full message body
      const detailRes = await fetch(`https://api.postmarkapp.com/messages/inbound/${msg.MessageID}/details`, {
        headers: { "X-Postmark-Server-Token": POSTMARK_TOKEN!, "Accept": "application/json" },
      });
      if (!detailRes.ok) continue;
      const detail = await detailRes.json();

      const result = await processCustodyEmail({
        From: detail.From ?? "",
        To: detail.To ?? "",
        Subject: detail.Subject ?? "",
        TextBody: detail.TextBody ?? "",
        HtmlBody: detail.HtmlBody ?? "",
      });
      results.push({ messageId: msg.MessageID, subject: detail.Subject, result });
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
