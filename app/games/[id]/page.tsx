import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { ListingCard } from "@/components/listings/ListingCard";
import { Countdown } from "@/components/ui/Countdown";
import { Badge } from "@/components/ui/Badge";

export const revalidate = 30;

type Props = { params: Promise<{ id: string }> };

export default async function GamePage({ params }: Props) {
  const { id } = await params;
  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      team: true,
      listings: {
        where: { status: "LIVE" },
        include: {
          seller: { select: { id: true, name: true } },
          _count: { select: { bids: { where: { status: "PENDING" } } } },
        },
        orderBy: { askingPrice: "asc" },
      },
    },
  });

  if (!game) notFound();

  const statusBadgeVariant = {
    UPCOMING: "yellow" as const,
    LIVE: "green" as const,
    FINISHED: "gray" as const,
    CANCELLED: "red" as const,
  }[game.status] ?? ("gray" as const);

  return (
    <div>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Badge variant={statusBadgeVariant}>
            {game.status === "LIVE" ? "🔴 Flash Window Open" : game.status}
          </Badge>
          <span className="text-sm text-gray-500">{game.team.name}</span>
        </div>
        <h1 className="text-3xl font-black text-white mb-1">
          {game.awayTeam} <span className="text-gray-500 font-normal">at</span> {game.homeTeam}
        </h1>
        <p className="text-gray-400">{game.venue}</p>
        <p className="text-white font-semibold mt-2">{formatDate(game.gameTime)}</p>

        {(game.status === "UPCOMING" || game.status === "LIVE") && (
          <div className="mt-6 pt-6 border-t border-gray-800">
            <Countdown gameTime={game.gameTime.toISOString()} />
          </div>
        )}
      </div>


      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">
            {game.status === "LIVE" ? "Tickets Available Now" : "Upcoming Tickets"}
          </h2>
          <span className="text-sm text-gray-500">
            {game.listings.length} live listing{game.listings.length !== 1 ? "s" : ""}
          </span>
        </div>

        {game.status === "UPCOMING" && (
          <div className="bg-yellow-900/20 border border-yellow-800 rounded-xl p-4 mb-6 text-sm text-yellow-400">
            Tickets will go live starting 60 minutes before first pitch. Check back closer to game time for the best deals.
          </div>
        )}

        {game.status === "FINISHED" || game.status === "CANCELLED" ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg">This game has ended. All listings are closed.</p>
          </div>
        ) : game.listings.length === 0 && game.status === "LIVE" ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg">No tickets live yet.</p>
            <p className="text-sm mt-1">More tickets may go live closer to first pitch.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {game.listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} showBidCount />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
