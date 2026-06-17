import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const resend = new Proxy({} as Resend, {
  get(_t, prop) { return (getResend() as any)[prop]; },
});

const FROM = "BuzzerSeats <notifications@buzzerseats.com>";
const ADMIN_EMAIL = "info@spiegelcos.com";

// Shared header/footer HTML fragments
const header = `
  <div style="background:#00438c;padding:24px 32px;border-radius:12px 12px 0 0;">
    <h1 style="color:#fff;margin:0;font-size:22px;font-family:sans-serif;">Buzzer Seats</h1>
  </div>
`;
const wrap = (body: string) => `
  <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111;">
    ${header}
    <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e5e5;border-top:none;">
      ${body}
    </div>
  </div>
`;

// ---------------------------------------------------------------------------
// 1. Draft created — confirmation to seller
// ---------------------------------------------------------------------------
export async function sendDraftCreatedEmail({
  to,
  sellerName,
  game,
  section,
  row,
  seatNumbers,
  askingPrice,
  triggerType,
  custodyEmail,
}: {
  to: string;
  sellerName: string;
  game: string;
  section: string;
  row: string;
  seatNumbers: string;
  askingPrice: number;
  triggerType: string;
  custodyEmail: string;
}) {
  const triggerLabel: Record<string, string> = {
    T_60: "60 minutes before first pitch",
    T_30: "30 minutes before first pitch",
    POST_START: "at first pitch",
  };

  await resend.emails.send({
    from: FROM,
    to,
    subject: `Draft listing saved — ${game}`,
    html: wrap(`
      <h2 style="margin:0 0 8px;">Draft listing saved ✓</h2>
      <p style="color:#555;margin:0 0 24px;">
        Hi ${sellerName}, your listing is saved as a draft. Your ticket stays in your MLB Ballpark app
        — you're free to keep trying to sell it elsewhere.
      </p>

      <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-weight:600;">${game}</p>
        <p style="margin:0 0 4px;color:#555;">Section ${section} · Row ${row} · Seats ${seatNumbers}</p>
        <p style="margin:0;font-size:18px;font-weight:700;color:#00438c;">$${askingPrice.toFixed(2)}</p>
      </div>

      <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-weight:700;color:#854d0e;">⏰ What happens next</p>
        <p style="margin:0;color:#713f12;font-size:14px;">
          We'll send you a high-priority alert 30 minutes before your listing is scheduled to go live
          (<strong>${triggerLabel[triggerType] ?? triggerType}</strong>). When you get that alert,
          open the MLB Ballpark app and forward your ticket to:
        </p>
        <p style="margin:12px 0 0;font-family:monospace;font-size:16px;font-weight:700;color:#00438c;">
          ${custodyEmail}
        </p>
        <p style="margin:8px 0 0;color:#555;font-size:13px;">
          The moment we receive it, your listing goes live to buyers instantly.
        </p>
      </div>

      <p style="color:#888;font-size:13px;margin:0;">
        If you sell elsewhere before the alert, no action needed — simply ignore the notification.
      </p>
    `),
  });
}

// ---------------------------------------------------------------------------
// 2. Transfer alert — 30-min warning to seller
// ---------------------------------------------------------------------------
export async function sendTransferAlertEmail({
  to,
  sellerName,
  game,
  gameTime,
  section,
  row,
  seatNumbers,
  triggerType,
  custodyEmail,
}: {
  to: string;
  sellerName: string;
  game: string;
  gameTime: Date;
  section: string;
  row: string;
  seatNumbers: string;
  triggerType: string;
  custodyEmail: string;
}) {
  const triggerLabel: Record<string, string> = {
    T_60: "60 minutes before first pitch",
    T_30: "30 minutes before first pitch",
    POST_START: "at first pitch",
  };

  await resend.emails.send({
    from: FROM,
    to,
    subject: `⚡ ACTION REQUIRED — Transfer your ticket now | ${game}`,
    html: wrap(`
      <h2 style="margin:0 0 8px;color:#dc2626;">⚡ Transfer your ticket NOW</h2>
      <p style="color:#555;margin:0 0 24px;">
        Hi ${sellerName}, your Buzzer Seats listing for <strong>${game}</strong> goes live in
        <strong>30 minutes</strong> (${triggerLabel[triggerType] ?? triggerType}).
      </p>

      <div style="background:#fef2f2;border:2px solid #dc2626;border-radius:8px;padding:20px;margin-bottom:24px;text-align:center;">
        <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.05em;">
          Step 1 — Open MLB Ballpark App
        </p>
        <p style="margin:0 0 16px;color:#555;font-size:14px;">
          Find your ticket for Section ${section} · Row ${row} · Seats ${seatNumbers}
        </p>
        <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.05em;">
          Step 2 — Forward it to
        </p>
        <p style="margin:0;font-family:monospace;font-size:20px;font-weight:700;color:#00438c;">
          ${custodyEmail}
        </p>
      </div>

      <p style="color:#555;font-size:14px;margin:0 0 8px;">
        Once we receive the ticket transfer, your listing activates instantly and buyers can purchase it.
      </p>
      <p style="color:#888;font-size:13px;margin:0;">
        Already sold it elsewhere? Ignore this message — your draft will simply expire.
      </p>
    `),
  });
}

// ---------------------------------------------------------------------------
// 3. Listing is LIVE — custody confirmed, buyers can see it
// ---------------------------------------------------------------------------
export async function sendListingLiveEmail({
  to,
  sellerName,
  game,
  section,
  row,
  seatNumbers,
  askingPrice,
  expiryLabel,
  expiresAt,
}: {
  to: string;
  sellerName: string;
  game: string;
  section: string;
  row: string;
  seatNumbers: string;
  askingPrice: number;
  expiryLabel: string;
  expiresAt: Date;
}) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Your ticket is LIVE — buyers can see it | ${game}`,
    html: wrap(`
      <h2 style="margin:0 0 8px;color:#16a34a;">Your listing is LIVE ✓</h2>
      <p style="color:#555;margin:0 0 24px;">
        Hi ${sellerName}, we've received your ticket and your listing is now visible to buyers.
      </p>

      <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-weight:600;">${game}</p>
        <p style="margin:0 0 4px;color:#555;">Section ${section} · Row ${row} · Seats ${seatNumbers}</p>
        <p style="margin:0;font-size:18px;font-weight:700;color:#00438c;">$${askingPrice.toFixed(2)}</p>
      </div>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;color:#166534;">
          ⏱ Your listing will auto-expire <strong>${expiryLabel}</strong>
          (${expiresAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" })} ET)
          if unsold. We'll return your ticket automatically.
        </p>
      </div>

      <p style="color:#888;font-size:13px;margin:0;">
        If you receive a sale notification, 85% of the sale price will be transferred to your bank account automatically.
      </p>
    `),
  });
}

// ---------------------------------------------------------------------------
// 4. Ticket returned — listing expired, seller gets their ticket back
// ---------------------------------------------------------------------------
export async function sendTicketReturnEmail({
  to,
  sellerName,
  game,
  section,
  row,
  seatNumbers,
  mlbTransferLink,
}: {
  to: string;
  sellerName: string;
  game: string;
  section: string;
  row: string;
  seatNumbers: string;
  mlbTransferLink?: string;
}) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Your ticket is being returned — ${game}`,
    html: wrap(`
      <h2 style="margin:0 0 8px;">Listing expired — ticket returned</h2>
      <p style="color:#555;margin:0 0 24px;">
        Hi ${sellerName}, your listing for <strong>${game}</strong> expired without a sale.
        We're transferring your ticket back to your MLB Ballpark account right now.
      </p>

      <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-weight:600;">${game}</p>
        <p style="margin:0;color:#555;">Section ${section} · Row ${row} · Seats ${seatNumbers}</p>
      </div>

      ${mlbTransferLink ? `
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-weight:700;font-size:14px;color:#0c4a6e;">Claim your ticket</p>
        <p style="margin:0 0 12px;font-size:14px;color:#555;">
          Click the link below to accept the transfer back into your MLB Ballpark app:
        </p>
        <a href="${mlbTransferLink}"
           style="display:inline-block;background:#00438c;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
          Accept Ticket Transfer →
        </a>
      </div>
      ` : `
      <p style="color:#555;font-size:14px;margin:0 0 16px;">
        Check your MLB Ballpark app — the ticket transfer should appear within a few minutes.
        If you don't see it, reply to this email and we'll sort it out.
      </p>
      `}

      <p style="color:#888;font-size:13px;margin:0;">
        Thanks for listing with Buzzer Seats. We hope to see you next game! 🎯
      </p>
    `),
  });
}

// ---------------------------------------------------------------------------
// 5. Admin — new draft listing notification
// ---------------------------------------------------------------------------
export async function sendAdminNewListingEmail({
  sellerName,
  sellerEmail,
  game,
  section,
  row,
  seatNumbers,
  askingPrice,
  barcodeNumber,
  listingId,
}: {
  sellerName: string;
  sellerEmail: string;
  game: string;
  section: string;
  row: string;
  seatNumbers: string;
  askingPrice: number;
  barcodeNumber: string;
  listingId: string;
}) {
  await resend.emails.send({
    from: FROM,
    to: ADMIN_EMAIL,
    subject: `New draft listing — ${game}`,
    html: wrap(`
      <h2 style="margin:0 0 8px;">New draft listing</h2>
      <p style="color:#555;margin:0 0 24px;">
        A seller has pre-listed a ticket. No action needed — the listing activates automatically
        when the seller forwards the ticket to deposits@buzzerseats.com.
      </p>

      <div style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:14px;color:#888;text-transform:uppercase;letter-spacing:.05em;">Listing Details</p>
        <p style="margin:0 0 4px;font-weight:600;">${game}</p>
        <p style="margin:0 0 4px;color:#555;">Section ${section} · Row ${row} · Seats ${seatNumbers}</p>
        <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#00438c;">$${askingPrice.toFixed(2)}</p>
        <p style="margin:0 0 4px;font-size:14px;color:#888;">Seller: ${sellerName} (${sellerEmail})</p>
        <div style="margin-top:12px;background:#f3f4f6;border-radius:6px;padding:10px 14px;display:inline-block;">
          <span style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em;">Barcode</span><br/>
          <span style="font-family:monospace;font-size:16px;font-weight:700;color:#111;">${barcodeNumber}</span>
        </div>
      </div>

      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/admin"
         style="display:inline-block;background:#00438c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
        View Admin Panel →
      </a>
    `),
  });
}
