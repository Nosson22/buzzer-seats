import Link from "next/link";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";

const TEAM_ACCENT: Record<string, string> = {
  heat:       "var(--heat-red)",
  dolphins:   "var(--dolphins-teal)",
  buccaneers: "var(--bucs-red)",
  marlins:    "var(--marlins-blue)",
};

const SPORT_LABEL: Record<string, string> = {
  heat:       "NBA",
  dolphins:   "NFL",
  buccaneers: "NFL",
  marlins:    "MLB",
};

interface GameCardProps {
  game: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    venue: string;
    gameTime: string | Date;
    status: string;
    team: { name: string; slug: string; sport?: string };
    _count?: { listings: number };
  };
}

const statusBadge = {
  UPCOMING: { label: "Upcoming", variant: "yellow" as const },
  LIVE: { label: "🔴 Live Window", variant: "green" as const },
  FINISHED: { label: "Final", variant: "gray" as const },
  CANCELLED: { label: "Cancelled", variant: "red" as const },
};

export function GameCard({ game }: GameCardProps) {
  const badge = statusBadge[game.status as keyof typeof statusBadge] ?? { label: game.status, variant: "gray" as const };
  const accent = TEAM_ACCENT[game.team.slug] ?? "var(--brand)";
  const sportLabel = SPORT_LABEL[game.team.slug] ?? game.team.sport?.toUpperCase() ?? "";

  return (
    <Link href={`/games/${game.id}`}>
      <div className="relative bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-600 hover:bg-gray-800/50 transition-all cursor-pointer overflow-hidden">
        {/* team color strip */}
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl" style={{ backgroundColor: accent }} />

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>{sportLabel}</span>
          </div>
          {game._count && game._count.listings > 0 && (
            <span className="text-xs text-green-400 font-semibold">
              {game._count.listings} listing{game._count.listings !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <h3 className="font-bold text-white text-lg leading-tight">
          {game.awayTeam} <span className="text-gray-500 font-normal">at</span> {game.homeTeam}
        </h3>
        <p className="text-sm text-gray-400 mt-1">{game.venue}</p>
        <p className="text-sm text-gray-300 mt-2 font-medium">{formatDate(game.gameTime)}</p>

        {game.status === "UPCOMING" && (
          <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
            Listings open closer to game time
          </div>
        )}
        {game.status === "LIVE" && (
          <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-green-400 font-semibold">
            Tickets available now — buy before the game starts!
          </div>
        )}
      </div>
    </Link>
  );
}
