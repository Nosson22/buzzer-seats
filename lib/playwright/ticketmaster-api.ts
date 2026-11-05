/**
 * Direct HTTP API client for Ticketmaster Account Manager.
 *
 * Bypasses Playwright/browser entirely by calling the AM REST API directly
 * using session cookies from TM_SESSION_STATE. This avoids Cloudflare bot
 * detection and eliminates the need for a headless browser.
 *
 * Discovered API endpoints (via reverse engineering am.ticketmaster.com/heat):
 *   GET  /{team}/session/token              → Drupal CSRF token
 *   GET  /{team}/api/v2/member/events       → List events in account
 *   GET  /{team}/api/v2/member/events/{id}/sections       → Sections in event
 *   GET  /{team}/api/v2/member/events/{id}/sections/{id}  → Section detail (canTransfer per seat)
 *   POST /{team}/api/v2/members/transfers   → Create transfer (X-CSRF-Token required)
 *   GET  /{team}/api/members/transfers?token={token}      → Poll queue-based transfer
 *
 * Transfer body:
 *   { invites: [{ recipient: { firstName, lastName, email }, seatIds: ["eventId.section.row.seat"] }] }
 *
 * Seat ID format: "{tmEventId}.{section}.{row}.{seatNumber}"
 *
 * Auth: Drupal session cookies (SSESS..., SID, eps_sid) from TM_SESSION_STATE.
 * After the MFA OTP flow is completed once, the session cookies include MFA state.
 */

import https from "https";
import http from "http";
import { URL } from "url";

export interface TMApiParams {
  teamSlug: string;
  /** TM Account Manager event ID (numeric). If not known, will be searched. */
  tmEventId?: number | string;
  section: string;
  row: string;
  seatNumbers: string;
  buyerEmail: string;
  buyerFirstName?: string;
  buyerLastName?: string;
}

export interface TMApiResult {
  success: boolean;
  message: string;
  transferId?: string;
  canTransferFailed?: string[];
}

function buildCookieHeader(sessionState: { cookies?: Array<{ name: string; value: string; domain: string }> }, domain: string): string {
  if (!sessionState.cookies) return "";
  return sessionState.cookies
    .filter((c) => domain.includes(c.domain.replace(/^\./, "")) || c.domain.replace(/^\./, "").includes("ticketmaster.com"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function httpRequest(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  proxyUrl?: string;
}): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const { url, method = "GET", headers = {}, body, proxyUrl } = options;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === "https:" ? https : http;

    const reqOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        ...headers,
      },
    };

    if (proxyUrl) {
      const proxy = new URL(proxyUrl);
      reqOptions.hostname = proxy.hostname;
      reqOptions.port = proxy.port ? parseInt(proxy.port) : 80;
      reqOptions.path = url;
      if (proxy.username && proxy.password) {
        (reqOptions.headers as Record<string, string>)["Proxy-Authorization"] =
          "Basic " + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64");
      }
    }

    const req = lib.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") respHeaders[k.toLowerCase()] = v;
          else if (Array.isArray(v)) respHeaders[k.toLowerCase()] = v.join(", ");
        }
        resolve({ status: res.statusCode ?? 0, body: data, headers: respHeaders });
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function transferTicketsTMApi(params: TMApiParams): Promise<TMApiResult> {
  const { teamSlug, tmEventId, section, row, seatNumbers, buyerEmail, buyerFirstName = "Buyer", buyerLastName = "Guest" } = params;

  const sessionStateB64 = process.env.TM_SESSION_STATE;
  if (!sessionStateB64) {
    return { success: false, message: "TM_SESSION_STATE not set — cannot authenticate" };
  }

  let sessionState: { cookies?: Array<{ name: string; value: string; domain: string }> };
  try {
    sessionState = JSON.parse(Buffer.from(sessionStateB64, "base64").toString("utf-8"));
  } catch {
    return { success: false, message: "TM_SESSION_STATE is not valid base64 JSON" };
  }

  const baseUrl = `https://am.ticketmaster.com/${teamSlug}`;
  const cookieHeader = buildCookieHeader(sessionState, "am.ticketmaster.com");
  const proxyUrl = process.env.BRIGHTDATA_PROXY_URL;

  const commonHeaders: Record<string, string> = {
    Cookie: cookieHeader,
    Origin: baseUrl,
    Referer: `${baseUrl}/my-events`,
  };

  // Step 1: Verify session is valid by checking events
  console.log("[TM-API] Checking session validity...");
  const eventsResp = await httpRequest({
    url: `${baseUrl}/api/v2/member/events?_format=json`,
    headers: { ...commonHeaders, Accept: "application/json" },
    proxyUrl,
  });

  if (eventsResp.status === 403 || eventsResp.status === 401) {
    return { success: false, message: `Session invalid (${eventsResp.status}) — need to refresh TM_SESSION_STATE` };
  }
  console.log(`[TM-API] Session valid (events status: ${eventsResp.status})`);

  // Step 2: Find the TM event ID if not provided
  let resolvedEventId: number | string | undefined = tmEventId;
  if (!resolvedEventId) {
    console.log(`[TM-API] tmEventId not provided — searching account events for section ${section}...`);
    let eventsData: any;
    try {
      eventsData = JSON.parse(eventsResp.body);
    } catch {
      eventsData = null;
    }
    const accountEvents: Array<{ id: number | string }> = eventsData?._embedded?.events ?? [];
    for (const ev of accountEvents) {
      const checkResp = await httpRequest({
        url: `${baseUrl}/api/v2/member/events/${ev.id}/sections?_format=json`,
        headers: { ...commonHeaders, Accept: "application/json" },
        proxyUrl,
      });
      try {
        const checkData = JSON.parse(checkResp.body);
        const secs = checkData._embedded?.sections ?? [];
        if (secs.some((s: any) => s.name === section || s.name === section.toUpperCase())) {
          resolvedEventId = ev.id;
          console.log(`[TM-API] Found section ${section} in event ${resolvedEventId}`);
          break;
        }
      } catch {}
    }
    if (!resolvedEventId) {
      return { success: false, message: `Could not find event with section ${section} in TM account` };
    }
  }

  // Step 3a: Get all sections for this event and find matching seat IDs
  console.log(`[TM-API] Looking up section ${section} row ${row} in event ${resolvedEventId}...`);
  const sectionsResp = await httpRequest({
    url: `${baseUrl}/api/v2/member/events/${resolvedEventId}/sections?_format=json`,
    headers: { ...commonHeaders, Accept: "application/json" },
    proxyUrl,
  });

  let targetSectionId: number | null = null;
  try {
    const sectionsData = JSON.parse(sectionsResp.body);
    const sections = sectionsData._embedded?.sections ?? [];
    const matched = sections.find((s: any) => s.name === section || s.name === section.toUpperCase());
    if (matched) {
      targetSectionId = matched.id;
      console.log(`[TM-API] Found section ${section} → id ${targetSectionId}`);
    } else {
      console.warn(`[TM-API] Section ${section} not found among: ${sections.map((s: any) => s.name).join(", ")}`);
    }
  } catch (e) {
    console.warn("[TM-API] Could not parse sections response:", sectionsResp.body.slice(0, 200));
  }

  // Step 3: Get seat IDs and check canTransfer
  const seats = seatNumbers.split(",").map((s) => s.trim());
  const seatIds: string[] = [];
  const cannotTransfer: string[] = [];

  // Step 3b: Get seat detail to find seat IDs and canTransfer
  if (targetSectionId) {
    const sectionResp = await httpRequest({
      url: `${baseUrl}/api/v2/member/events/${resolvedEventId}/sections/${targetSectionId}?_format=json`,
      headers: { ...commonHeaders, Accept: "application/json" },
      proxyUrl,
    });

    try {
      const sectionData = JSON.parse(sectionResp.body);
      for (const rowData of sectionData.rows ?? []) {
        if (rowData.name !== row) continue;
        for (const seat of rowData.seats ?? []) {
          if (seats.includes(String(seat.number))) {
            if (seat.actions?.canTransfer === false) {
              cannotTransfer.push(`Sec ${section} Row ${row} Seat ${seat.number}`);
              console.warn(`[TM-API] Seat ${seat.id} canTransfer=false — skipping`);
            } else {
              seatIds.push(seat.id);
              console.log(`[TM-API] Seat ${seat.id} is transferable ✓`);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[TM-API] Could not parse section detail:", sectionResp.body.slice(0, 200));
    }
  }

  // Fallback: construct seat ID from event/section/row/seat (works if format matches)
  if (seatIds.length === 0 && cannotTransfer.length === 0) {
    console.warn("[TM-API] Could not look up seat IDs — falling back to constructed IDs");
    for (const seat of seats) {
      seatIds.push(`${resolvedEventId}.${section}.${row}.${seat}`);
    }
  }

  if (seatIds.length === 0) {
    const msg = cannotTransfer.length > 0
      ? `Tickets cannot be transferred (canTransfer=false): ${cannotTransfer.join(", ")}`
      : `No matching seats found: section=${section} row=${row} seats=${seatNumbers}`;
    return { success: false, message: msg, canTransferFailed: cannotTransfer };
  }

  // Step 4: Get CSRF token
  console.log("[TM-API] Getting CSRF token...");
  const csrfResp = await httpRequest({
    url: `${baseUrl}/session/token`,
    headers: commonHeaders,
    proxyUrl,
  });
  const csrfToken = csrfResp.body.trim();
  if (!csrfToken || csrfToken.length < 8) {
    return { success: false, message: `Failed to get CSRF token (status ${csrfResp.status})` };
  }
  console.log(`[TM-API] Got CSRF token (length ${csrfToken.length})`);

  // Step 5: POST transfer
  const transferBody = {
    invites: [
      {
        note: "",
        recipient: {
          firstName: buyerFirstName,
          lastName: buyerLastName,
          email: buyerEmail,
        },
        seatIds,
      },
    ],
  };

  console.log(`[TM-API] POSTing transfer: ${seatIds.length} seat(s) → ${buyerEmail}`);
  console.log(`[TM-API] Body:`, JSON.stringify(transferBody));

  const transferResp = await httpRequest({
    url: `${baseUrl}/api/v2/members/transfers`,
    method: "POST",
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(transferBody),
    proxyUrl,
  });

  console.log(`[TM-API] Transfer response: ${transferResp.status}`);
  console.log(`[TM-API] Transfer body (first 500):`, transferResp.body.slice(0, 500));

  if (transferResp.status === 202) {
    // Queue-based transfer — poll for result
    const token = (() => {
      try {
        return JSON.parse(transferResp.body)?.token ?? "";
      } catch {
        return "";
      }
    })();

    if (token) {
      console.log("[TM-API] Transfer queued, polling for result...");
      for (let attempt = 0; attempt < 25; attempt++) {
        await new Promise((r) => setTimeout(r, 6_000));
        const pollResp = await httpRequest({
          url: `${baseUrl}/api/members/transfers?token=${token}`,
          headers: { ...commonHeaders, Accept: "application/json" },
          proxyUrl,
        });
        if (pollResp.status === 201) {
          const pollData = JSON.parse(pollResp.body);
          const invites = pollData?.invites ?? [];
          const transferId = invites[0]?.id;
          return { success: true, message: `Transferred ${seatIds.length} ticket(s) to ${buyerEmail}`, transferId };
        }
        console.log(`[TM-API] Poll attempt ${attempt + 1}: status ${pollResp.status}`);
      }
      return { success: false, message: "Transfer polling timed out" };
    }
    return { success: false, message: "202 response but no queue token" };
  }

  if (transferResp.status === 201) {
    const data = JSON.parse(transferResp.body);
    const transferId = data?.invites?.[0]?.id;
    return { success: true, message: `Transferred ${seatIds.length} ticket(s) to ${buyerEmail}`, transferId };
  }

  // Error response
  let errMsg = `Transfer failed with status ${transferResp.status}`;
  try {
    const errData = JSON.parse(transferResp.body);
    const errDetails = errData?.errors?.map((e: any) => e.message).join("; ") ?? errData?.message ?? "";
    if (errDetails) errMsg += `: ${errDetails}`;
  } catch {}

  return { success: false, message: errMsg };
}
