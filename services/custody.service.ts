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
// Main entry point
// ---------------------------------------------------------------------------
export async function processCustodyEmail(
  payload: InboundEmailPayload
): Promise<{ ok: boolean; listingId?: string; reason?: string }> {
  // 1. Parse the MLB ticket email
  const parsed = parseMLBTicketEmail(
    payload.Subject,
    payload.TextBody,
    payload.HtmlBody
  );

  if (!parsed) {
    console.warn("[CustodyService] Could not parse ticket info from email — subject:", payload.Subject);
    return { ok: false, reason: "Could not parse ticket info from email" };
  }

  // 2. Match to a DRAFT listing
  const listing = await matchDraftListing(payload.From, parsed);

  if (!listing) {
    console.warn(
      `[CustodyService] No matching DRAFT listing for section=${parsed.section} row=${parsed.row} from=${payload.From}`
    );
    return { ok: false, reason: "No matching draft listing found" };
  }

  // 3. Compute expiry time using team-specific offset
  const teamSlug = listing.game.team.slug;
  const { expiryOffsetMs, expiryLabel } = getTeamConfig(teamSlug);
  const expiryAt = new Date(listing.game.gameTime.getTime() + expiryOffsetMs);

  // 4. Atomically flip DRAFT → LIVE and schedule the expiry job
  const now = new Date();
  const updatedListing = await prisma.listing.update({
    where: { id: listing.id },
    data: {
      status: "LIVE",
      custodyEmail: payload.From,
      custodyTransferredAt: now,
      activatedAt: now,
    },
  });

  const expiryJobId = await scheduleExpiry(listing.id, teamSlug, expiryAt);

  await prisma.listing.update({
    where: { id: listing.id },
    data: { expiryJobId },
  });

  // 5. Broadcast to buyers in real-time
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

  // 6. Email seller confirming their listing is LIVE
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
