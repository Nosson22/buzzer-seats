/**
 * Per-team configuration for the Pre-Listed Draft model.
 *
 * expiryOffsetMs — how long after first pitch a LIVE ticket stays open
 *   before it is auto-expired and returned to the seller.
 *   Different sports have very different in-game ticket dynamics:
 *     MLB      → buyers still want to buy up until ~T+30 (game is slow-paced, fans arrive late)
 *     NBA/NHL  → fast game; buyers rarely buy after T+10
 *     NFL      → longest games; keep window open until T+60
 *
 * custodyEmail — the MLB Ballpark / partner inbound address sellers must forward to.
 *   In production this is a Postmark/SendGrid inbound address.
 */

export interface TeamConfig {
  /** Milliseconds after first pitch before LIVE unsold tickets are expired. */
  expiryOffsetMs: number;
  /** Human-readable label shown in seller-facing emails. */
  expiryLabel: string;
}

/** Keyed by Team.slug. Falls back to DEFAULT for unknown slugs. */
const TEAM_CONFIG: Record<string, TeamConfig> = {
  marlins: {
    expiryOffsetMs: 45 * 60 * 1_000, // T+45 min
    expiryLabel: "45 minutes after first pitch",
  },
  // Add more teams as you expand:
  // heat:    { expiryOffsetMs: 10 * 60 * 1_000, expiryLabel: "10 minutes after tip-off" },
  // dolphins:{ expiryOffsetMs: 60 * 60 * 1_000, expiryLabel: "60 minutes after kickoff" },
};

const DEFAULT_CONFIG: TeamConfig = {
  expiryOffsetMs: 45 * 60 * 1_000,
  expiryLabel: "45 minutes after the game starts",
};

export function getTeamConfig(teamSlug: string): TeamConfig {
  return TEAM_CONFIG[teamSlug] ?? DEFAULT_CONFIG;
}

/** The inbound email address sellers forward their MLB ticket to. */
export const CUSTODY_INBOUND_EMAIL = "deposits@buzzerseats.com";
