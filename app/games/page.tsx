import { prisma } from "@/lib/prisma";
import { GameCard } from "@/components/games/GameCard";

export const revalidate = 60;

export default async function GamesPage() {
  const games = await prisma.game.findMany({
    where: {
      team: { slug: "marlins" },
      gameTime: { gt: new Date() },
      status: { not: "CANCELLED" },
    },
    include: {
      team: { select: { name: true, slug: true } },
      _count: { select: { listings: { where: { status: "LIVE" } } } },
    },
    orderBy: { gameTime: "asc" },
  }).catch(() => []);

  const liveGames = games.filter((g) => g.status === "LIVE");
  const upcomingGames = games.filter((g) => g.status === "UPCOMING");

  return (
    <div>
      <h1 className="text-3xl font-black text-white mb-2">Miami Marlins Games</h1>
      <p className="text-gray-400 mb-8">
        Browse upcoming games. Flash Ticket listings go live based on each seller&apos;s chosen trigger — 60 min, 30 min, or at first pitch.
      </p>

      {liveGames.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
            <h2 className="text-xl font-bold text-green-400">Live Now — Buzzer Seats Available!</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold mb-4 text-white">Upcoming Games</h2>
        {upcomingGames.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg">No upcoming games scheduled.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
