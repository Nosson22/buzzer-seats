import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { GameCard } from "@/components/games/GameCard";

export const revalidate = 60;

const TEAM_TABS = [
  { slug: "all",        label: "All Games",               sport: null },
  { slug: "heat",       label: "🏀 Heat",                 sport: "NBA"  },
  { slug: "dolphins",   label: "🐬 Dolphins",             sport: "NFL"  },
  { slug: "buccaneers", label: "🏈 Buccaneers",           sport: "NFL"  },
  { slug: "marlins",    label: "⚾ Marlins",               sport: "MLB"  },
];

export default async function GamesPage({
  searchParams,
}: {
  searchParams: { team?: string };
}) {
  const activeTeam = searchParams?.team ?? "all";

  const games = await prisma.game.findMany({
    where: {
      ...(activeTeam !== "all" ? { team: { slug: activeTeam } } : {}),
      status: { in: ["LIVE", "UPCOMING"] },
      gameTime: { gt: new Date() },
    },
    include: {
      team: { select: { name: true, slug: true, sport: true } },
      _count: { select: { listings: { where: { status: "LIVE" } } } },
    },
    orderBy: { gameTime: "asc" },
  }).catch(() => []);

  const liveGames = games.filter((g) => g.status === "LIVE");
  const upcomingGames = games.filter((g) => g.status === "UPCOMING");

  const activeTab = TEAM_TABS.find((t) => t.slug === activeTeam) ?? TEAM_TABS[0];

  return (
    <div>
      <h1 className="text-3xl font-black text-white mb-2">Browse Games</h1>
      <p className="text-gray-400 mb-6">
        Listings go live based on each seller's chosen trigger — 60 min, 30 min, or at game time.
      </p>

      {/* Team tabs */}
      <div className="flex gap-2 flex-wrap mb-8">
        {TEAM_TABS.map((tab) => (
          <Link
            key={tab.slug}
            href={tab.slug === "all" ? "/games" : `/games?team=${tab.slug}`}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all border ${
              activeTeam === tab.slug
                ? "bg-white text-gray-950 border-white"
                : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white bg-transparent"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {liveGames.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
            <h2 className="text-xl font-bold text-green-400">Live Now — Tickets Available!</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold mb-4 text-white">
          {activeTeam === "all" ? "Upcoming Games" : `${activeTab.label.replace(/^[^\s]+ /, "")} — Upcoming`}
        </h2>
        {upcomingGames.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            {activeTeam === "marlins"
              ? <p className="text-lg">Marlins season is over — check back in spring! ⚾</p>
              : <p className="text-lg">No upcoming games scheduled.</p>}
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
