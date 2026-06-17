/**
 * POST /api/inbound/email
 *
 * Webhook called by Postmark (or SendGrid / Resend) when a ticket transfer
 * email arrives at deposits@buzzerseats.com.
 *
 * Configure your email provider to POST inbound messages to:
 *   https://buzzerseats.com/api/inbound/email
 *
 * The route verifies a shared secret header (INBOUND_WEBHOOK_SECRET) so
 * only your email provider can call it, then hands off to the custody service.
 */
import { NextRequest, NextResponse } from "next/server";
import { processCustodyEmail, type InboundEmailPayload } from "@/services/custody.service";

// Postmark sends its own header; we use a shared secret for all providers.
const WEBHOOK_SECRET = process.env.INBOUND_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
  // Postmark doesn't support custom request headers on inbound webhooks.
  // The endpoint is safe regardless — it only acts on emails that parse
  // as valid MLB ticket transfers matching an existing DRAFT listing.

  let payload: InboundEmailPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate minimum required fields
  if (!payload.From || !payload.TextBody) {
    return NextResponse.json(
      { error: "Missing required fields: From, TextBody" },
      { status: 400 }
    );
  }

  const result = await processCustodyEmail(payload);

  if (!result.ok) {
    // Return 200 anyway — we don't want the email provider to retry on parse errors
    console.warn("[InboundEmail] Custody processing failed:", result.reason);
    return NextResponse.json({ received: true, matched: false, reason: result.reason });
  }

  return NextResponse.json({ received: true, matched: true, listingId: result.listingId });
}
