/**
 * Custody Service — Phase 3: Inbound Email → LIVE
 *
 * Called from POST /api/inbound/email when the inbound email webhook fires.
 *
 * Flow:
 *   1. Parse the forwarded MLB email to extract section / row / seat
 *   2. Match to a DRAFT listing by sellerId + gameId + section + row + seat
 *   3. Accept the transfer: flip DRAFT → LIVE, set activatedAt
 *   4. Schedule the expiry job (Phase 4)
 *   5. Broadcast to the buyer marketplace (WebSocket)
 *   6. Email the seller confirming their listing is now live
 *
 * The inbound email payload shape matches Postmark's inbound webhook.
 * If you're using SendGrid or Resend, adapt `parseInboundPayload` accordingly.
 */
import { prisma } from "../lib/prisma";
import { getTeamConfig } from "../lib/team-config";
import { scheduleExpiry } from "../lib/queue/expiry.queue";
import { emitListingAvailable } from "../lib/socket/emitters";
import { sendListingLiveEmail } from "../lib/email";
import { scheduleTransferToBuyer } from "../lib/queue/mlb-automation.queue";

// ---------------------------------------------------------------------------
// Inbound email payload (Postmark shape — adapt for other providers)
// ---------------------------------------------------------------------------
export interface InboundEmailPayload {
  From: string;           // e.g. "jsmith@example.com"
  To: string;             // should be deposits@buzzerseats.com
  Subject: string;
  TextBody: string;
  HtmlBody: string;
  Attachments?: Array<{
    Name: string;
    Content: string;      // base64
    ContentType: string;
  }>;
}

// ---------------------------------------------------------------------------
// MLB Ballpark email parser
// Extracts section, row, seat from the forwarded ticket email body.
// These patterns cover the standard MLB Ballpark app transfer email format.
// ---------------------------------------------------------------------------
export interface ParsedTicketInfo {
  section: string;
  row: string;
  seatNumbers: string;
}

export function parseMLBTicketEmail(
  subject: string,
  textBody: string,
  htmlBody: string
): ParsedTicketInfo | null {
  // Combine text and stripped HTML for broader matching
  const html = htmlBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const corpus = `${subject}\n${textBody}\n${html}`.toLowerCase();

  // Pattern: "section 15 / row C / seat 4" or "sec. 15, row C, seat 4"
  // MLB Ballpark uses varied formats across teams — we cover the most common.
  const patterns = [
    // "Section 15 · Row C · Seat 4"
    /section[:\s.]*([a-z0-9]+)[^a-z0-9]*row[:\s.]*([a-z0-9]+)[^a-z0-9]*seat[s]?[:\s.]*([a-z0-9,\s-]+)/i,
    // "Sec 15, Row C, Seats 4-5"
    /sec(?:tion)?[.:\s]+([a-z0-9]+)[^a-z0-9]+row[.:\s]+([a-z0-9]+)[^a-z0-9]+seat[s]?[.:\s]+([a-z0-9,\s-]+)/i,
    // Fallback: just look for "row X seat Y" without section
    /row[.:\s]+([a-z0-9]+)[^a-z0-9]+seat[s]?[.:\s]+([a-z0-9,\s-]+)/i,
  ];

  for (const pattern of patterns) {
    const m = corpus.match(pattern);
    if (m) {
      if (m.length === 4) {
        return {
          section: m[1].trim().toUpperCase(),
          row: m[2].trim().toUpperCase(),
          seatNumbers: m[3].trim().toUpperCase(),
        };
      }
      if (m.length === 3) {
        return {
          section: "UNKNOWN",
          row: m[1].trim().toUpperCase(),
          seatNumbers: m[2].trim().toUpperCase(),
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Match parsed ticket info to a DRAFT listing
// ---------------------------------------------------------------------------
async function matchDraftListing(
  senderEmail: string,
  parsed: ParsedTicketInfo
) {
  // First try: exact match on seller email + section + row (most reliable)
  const seller = await prisma.user.findUnique({
    where: { email: senderEmail },
    select: { id: true },
  });

  if (seller) {
    const listing = await prisma.listing.findFirst({
      where: {
        sellerId: seller.id,
        status: "DRAFT",
        section: { equals: parsed.section, mode: "insensitive" },
        row: { equals: parsed.row, mode: "insensitive" },
      },
      include: {
        game: { include: { team: true } },
        seller: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (listing) return listing;
  }

  // Fallback: any DRAFT listing matching section + row (for forwarded emails
  // where the sender address differs from the registered seller email)
  return prisma.listing.findFirst({
    where: {
      status: "DRAFT",
      section: { equals: parsed.section, mode: "insensitive" },
      row: { equals: parsed.row, mode: "insensitive" },
    },
    include: {
      game: { include: { team: true } },
      seller: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Extract MLB transfer accept URL from the email body.
// MLB sends a button/link like "Accept Tickets" that points to a tokenized URL.
// The token in the URL is all that's needed — no authenticated session required.
// ---------------------------------------------------------------------------
export function extractAcceptUrl(htmlBody: string, textBody: string): string | null {
  // Patterns for the MLB transfer accept link (cover known formats)
  const urlPatterns = [
    // HTML href containing "accept" or "transfer/accept"
    /href="(https?:\/\/[^"]*(?:accept|transfer)[^"]*(?:token|id)=[^"]+)"/i,
    /href='(https?:\/\/[^']*(?:accept|transfer)[^']*(?:token|id)=[^']+)'/i,
    // Plain-text URL
    /(https?:\/\/\S*(?:accept|transfer)\S*(?:token|id)=\S+)/i,
    // Broader: any mlb.com or bamnetworks.com link that looks like a transfer action
    /href="(https?:\/\/(?:[^"]*\.)?(?:mlb\.com|bamnetworks\.com|ticketmaster\.com)[^"]*(?:accept|transfer)[^"]+)"/i,
    /href='(https?:\/\/(?:[^']*\.)?(?:mlb\.com|bamnetworks\.com|ticketmaster\.com)[^']*(?:accept|transfer)[^']+)'/i,
  ];

  const corpus = `${htmlBody}\n${textBody}`;
  for (const pattern of urlPatterns) {
    const m = corpus.match(pattern);
    if (m?.[1]) {
      // Decode HTML entities (&amp; → &)
      return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Click the MLB accept URL to accept the ticket transfer.
// This is a simple HTTP GET — the token in the URL is the authentication.
// ---------------------------------------------------------------------------
async function clickAcceptUrl(acceptUrl: string): Promise<boolean> {
  console.log("[CustodyService] Clicking accept URL:", acceptUrl);
  try {
    const res = await fetch(acceptUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
    });
    console.log("[CustodyService] Accept URL response:", res.status, res.url);
    // MLB redirects to a success page; 200 or 3xx-then-200 both count as success
    return res.status < 400;
  } catch (err: any) {
    console.error("[CustodyService] Failed to click accept URL:", err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function processCustodyEmail(
  payload: InboundEmailPayload
): Promise<{ ok: boolean; listingId?: string; reason?: string }> {
  // 1. Extract the MLB accept transfer URL from the email body
  const acceptUrl = extractAcceptUrl(payload.HtmlBody, payload.TextBody);

  if (!acceptUrl) {
    console.warn("[CustodyService] No accept URL found in email — subject:", payload.Subject);
    // Still try to parse ticket info for matching, but we can't auto-accept without the URL
    return { ok: false, reason: "No transfer accept URL found in email body" };
  }

  console.log("[CustodyService] Found accept URL:", acceptUrl);

  // 2. Parse the MLB ticket email to identify the listing
  const parsed = parseMLBTicketEmail(
    payload.Subject,
    payload.TextBody,
    payload.HtmlBody
  );

  if (!parsed) {
    console.warn("[CustodyService] Could not parse ticket info from email — subject:", payload.Subject);
    return { ok: false, reason: "Could not parse ticket info from email" };
  }

  // 3. Match to a DRAFT listing
  const listing = await matchDraftListing(payload.From, parsed);

  if (!listing) {
    console.warn(
      `[CustodyService] No matching DRAFT listing for section=${parsed.section} row=${parsed.row} from=${payload.From}`
    );
    return { ok: false, reason: "No matching draft listing found" };
  }

  // 4. Click the accept URL — this accepts the transfer on MLB's side
  const accepted = await clickAcceptUrl(acceptUrl);

  const now = new Date();
  await prisma.listing.update({
    where: { id: listing.id },
    data: {
      custodyEmail: payload.From,
      custodyTransferredAt: now,
      ...(accepted ? { status: "LIVE", activatedAt: now } : {}),
    },
  });

  if (!accepted) {
    console.error(`[CustodyService] Accept URL click failed for listing ${listing.id} — manual review needed`);
    return { ok: false, reason: "Accept URL click failed", listingId: listing.id };
  }

  console.log(`[CustodyService] Transfer accepted for listing ${listing.id}`);

  // 5. Find active buyer reservation for this listing (if any) and queue transfer-to-buyer
  const reservation = await prisma.reservation.findFirst({
    where: { listingId: listing.id, status: "ACTIVE" },
    include: { buyer: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (reservation?.buyer?.email) {
    await scheduleTransferToBuyer(listing.id, reservation.buyer.email);
    console.log(`[CustodyService] Queued transfer-to-buyer for listing ${listing.id} → ${reservation.buyer.email}`);
  } else {
    console.log(`[CustodyService] No active buyer reservation yet for listing ${listing.id} — listing is now LIVE`);
    // Broadcast availability so buyers can see and reserve it
    try {
      emitListingAvailable(listing.game.id, {
        listingId: listing.id,
        gameId: listing.game.id,
        section: listing.section,
        row: listing.row,
        seatNumbers: listing.seatNumbers,
        quantity: listing.quantity,
        askingPrice: listing.askingPrice,
        triggeredBy: listing.liveTriggerType,
        activatedAt: now.toISOString(),
      });
    } catch (err: any) {
      console.warn("[CustodyService] WebSocket emit failed (non-fatal):", err.message);
    }
  }

  // 6. Email seller confirming transfer received and listing is live
  const { expiryOffsetMs, expiryLabel } = getTeamConfig(listing.game.team.slug);
  const expiryAt = new Date(listing.game.gameTime.getTime() + expiryOffsetMs);
  sendListingLiveEmail({
    to: listing.seller.email,
    sellerName: listing.seller.name,
    game: `${listing.game.awayTeam} at ${listing.game.homeTeam}`,
    section: listing.section,
    row: listing.row,
    seatNumbers: listing.seatNumbers,
    askingPrice: listing.askingPrice,
    expiryLabel,
    expiresAt: expiryAt,
  }).catch((e) => console.error("[CustodyService] Live email failed:", e.message));

  return { ok: true, listingId: listing.id };
}
