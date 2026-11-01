import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { GameCard } from "@/components/games/GameCard";

export const revalidate = 60;

const SPORTS = [
  { slug: "heat",        label: "Miami Heat",              sport: "NBA",  icon: "🏀", accent: "var(--heat-red)",      textColor: "#f9a01b" },
  { slug: "dolphins",    label: "Miami Dolphins",           sport: "NFL",  icon: "🐬", accent: "var(--dolphins-teal)", textColor: "#fc4c02" },
  { slug: "buccaneers",  label: "Tampa Bay Buccaneers",     sport: "NFL",  icon: "🏴‍☠️", accent: "var(--bucs-red)",      textColor: "#fff" },
  { slug: "marlins",     label: "Miami Marlins",            sport: "MLB",  icon: "⚾", accent: "var(--marlins-blue)",  textColor: "#fff" },
];

export default async function HomePage() {
  // Grab 1 next game per team to show in the sport cards
  const nextGames = await Promise.all(
    SPORTS.map((s) =>
      prisma.game.findFirst({
        where: { team: { slug: s.slug }, status: { in: ["UPCOMING", "LIVE"] }, gameTime: { gt: new Date() } },
        orderBy: { gameTime: "asc" },
        include: { _count: { select: { listings: { where: { status: "LIVE" } } } } },
      }).catch(() => null)
    )
  );

  return (
    <div>
      {/* Hero */}
      <section className="text-center py-16 px-4">
        <div className="inline-flex items-center gap-2 bg-green-900/30 border border-green-800 text-green-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          Last-minute tickets — deeply discounted, game-day prices
        </div>
        <h1 className="text-5xl md:text-6xl font-black text-white mb-4 leading-tight">
          Buzzer Seats
          <br />
          <span style={{ color: "var(--brand)" }}>Miami Sports</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
          Sellers who can't make the game drop their tickets at the last minute —
          and you grab them at a fraction of the price. Real seats, real savings,
          right up to tip-off, kickoff, or first pitch.
        </p>

        {/* Sport picker cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto mb-10">
          {SPORTS.map((sport, i) => {
            const next = nextGames[i];
            return (
              <Link key={sport.slug} href={`/games?team=${sport.slug}`}>
                <div
                  className="relative rounded-2xl border border-gray-800 bg-gray-900 hover:border-gray-600 hover:bg-gray-800/60 transition-all cursor-pointer p-5 text-left overflow-hidden"
                >
                  {/* color strip */}
                  <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ backgroundColor: sport.accent }} />
                  <div className="text-3xl mb-3">{sport.icon}</div>
                  <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: sport.textColor === "#fff" ? sport.accent : sport.textColor }}>
                    {sport.sport}
                  </div>
                  <div className="font-bold text-white text-sm leading-tight mb-2">{sport.label}</div>
                  {next ? (
                    <div className="text-xs text-gray-500">
                      {next._count.listings > 0
                        ? <span className="text-green-400 font-semibold">{next._count.listings} listing{next._count.listings !== 1 ? "s" : ""} live</span>
                        : "Next game upcoming"}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600 italic">Off-season</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/games"
            className="px-8 py-4 rounded-xl font-bold text-white text-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--brand)" }}
          >
            Browse All Games
          </Link>
          <Link
            href="/sell"
            className="px-8 py-4 rounded-xl font-bold text-white text-lg bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            Sell a Ticket
          </Link>
        </div>
      </section>

      {/* 100% Guarantee */}
      <section className="py-16 border-t border-gray-800">
        <div className="max-w-3xl mx-auto text-center">
          <img src="/guarantee.png" alt="100% Guaranteed" className="w-36 h-36 mx-auto mb-6 object-contain" />
          <h2 className="text-3xl font-black text-white mb-4">100% Guaranteed</h2>
          <p className="text-lg text-gray-400 mb-10">
            Every ticket on Buzzer Seats is backed by our full money-back guarantee.
            If something goes wrong — your money comes back, no questions asked.
            Or reach out and we'll personally find you a ticket to the game.
          </p>
          <div className="grid md:grid-cols-3 gap-6 text-left">
            {[
              {
                icon: "💸",
                title: "Full Refund",
                body: "If your ticket doesn't come through for any reason, you get every penny back immediately.",
              },
              {
                icon: "🎟️",
                title: "We'll Find You a Seat",
                body: "Don't want a refund? You just want to go to the game? We'll go the extra mile and source a replacement ticket.",
              },
              {
                icon: "📞",
                title: "Real Support",
                body: "Reach out directly and a real person responds — not a bot, not a form, not a 5-day wait.",
              },
            ].map((item) => (
              <div key={item.title} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="text-3xl mb-3">{item.icon}</div>
                <h3 className="font-bold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-gray-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
