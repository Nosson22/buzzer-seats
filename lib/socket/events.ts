/**
 * Canonical WebSocket event definitions.
 * Both the server (emitter) and client (listener) import from here
 * so they can never drift out of sync.
 */

export const SOCKET_ROOMS = {
  game: (gameId: string) => `game:${gameId}`,
  seller: (sellerId: string) => `seller:${sellerId}`,
} as const;

// ── Payload shapes ──────────────────────────────────────────────────────────

export interface ListingAvailablePayload {
  listingId: string;
  gameId: string;
  section: string;
  row: string;
  seatNumbers: string;
  quantity: number;
  askingPrice: number;
  triggeredBy: "T_60" | "T_30" | "POST_START";
  activatedAt: string; // ISO
}

export interface ListingRecalledPayload {
  listingId: string;
  gameId: string;
  recalledAt: string; // ISO
}

export interface ListingSoldPayload {
  listingId: string;
  gameId: string;
  soldAt: string; // ISO
}

export interface RecallConfirmedPayload {
  listingId: string;
  transferToken: string | null;
  message: string;
}

// ── Typed event maps (used by Socket.io generics) ───────────────────────────

/** Events the server emits to clients */
export interface ServerToClientEvents {
  "listing:available": (payload: ListingAvailablePayload) => void;
  "listing:recalled": (payload: ListingRecalledPayload) => void;
  "listing:sold": (payload: ListingSoldPayload) => void;
  "recall:confirmed": (payload: RecallConfirmedPayload) => void;
}

/** Events clients emit to the server */
export interface ClientToServerEvents {
  "game:subscribe": (gameId: string) => void;
  "game:unsubscribe": (gameId: string) => void;
  "seller:subscribe": (sellerId: string) => void;
}

/** Events used only between server instances (Socket.io adapter) */
export interface InterServerEvents {
  ping: () => void;
}

/** Per-socket data */
export interface SocketData {
  userId?: string;
  role?: string;
}
