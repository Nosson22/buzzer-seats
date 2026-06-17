import Link from "next/link";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";

interface GameCardProps {
  game: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    venue: string;
    gameTime: string | Date;
    status: string;
    team: { name: string; slug: string };
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

  return (
    <Link href={`/games/${game.id}`}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-600 hover:bg-gray-800/50 transition-all cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {game._count && (
            <span className="text-xs text-gray-500">
              {game._count.listings} active listing{game._count.listings !== 1 ? "s" : ""}
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
            Listings open 1 hour before game time
          </div>
        )}
        {game.status === "LIVE" && (
          <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-green-400 font-semibold">
            Tickets available now — buy before game starts!
          </div>
        )}
      </div>
    </Link>
  );
}
