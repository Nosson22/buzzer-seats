import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { GameCard } from "@/components/games/GameCard";

export const revalidate = 60;

export default async function HomePage() {
  const upcomingGames = await prisma.game.findMany({
    where: {
      status: { in: ["UPCOMING", "LIVE"] },
      gameTime: { gt: new Date() },
      team: { slug: "marlins" },
    },
    include: {
      team: { select: { name: true, slug: true } },
      _count: { select: { listings: { where: { status: "LIVE" } } } },
    },
    orderBy: { gameTime: "asc" },
    take: 3,
  }).catch(() => []);

  return (
    <div>
      {/* Hero */}
      <section className="text-center py-16 px-4">
        <div className="inline-flex items-center gap-2 bg-green-900/30 border border-green-800 text-green-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          Last-minute Marlins tickets — deeply discounted, game-day prices
        </div>
        <h1 className="text-5xl md:text-6xl font-black text-white mb-4 leading-tight">
          Buzzer Seats<br />
          <span style={{ color: "var(--marlins-blue)" }}>Miami Marlins</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
          Sellers who can't make the game drop their tickets at the last minute —
          and you grab them at a fraction of the price. Real seats, real savings,
          right up to first pitch.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/games"
            className="px-8 py-4 rounded-xl font-bold text-white text-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--marlins-blue)" }}
          >
            Browse Upcoming Games
          </Link>
          <Link
            href="/register?role=SELLER"
            className="px-8 py-4 rounded-xl font-bold text-white text-lg bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            Sell a Ticket
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="py-12 border-t border-gray-800">
        <h2 className="text-2xl font-bold text-center mb-8">How Buzzer Seats Works</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { icon: "📥", title: "Deposit", body: "Upload your ticket days before the game. It sits in escrow while you try to sell it at full price elsewhere." },
            { icon: "⏱", title: "Set Your Trigger", body: "Choose T‑60, T‑30, or First Pitch. Your listing auto-activates at exactly that moment." },
            { icon: "⚡", title: "One-Click Recall", body: "Sell on StubHub first? Hit Recall and your ticket is instantly removed — even if the window is live." },
            { icon: "💰", title: "Get Paid", body: "Buyer pays via Stripe. You receive 85% of the sale price directly." },
          ].map((step) => (
            <div key={step.title} className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
              <div className="text-4xl mb-3">{step.icon}</div>
              <h3 className="font-bold text-white mb-2">{step.title}</h3>
              <p className="text-sm text-gray-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Upcoming games */}
      {upcomingGames.length > 0 && (
        <section className="py-12 border-t border-gray-800">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">Upcoming Games</h2>
            <Link href="/games" className="text-sm font-medium" style={{ color: "var(--marlins-blue)" }}>
              View all →
            </Link>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {upcomingGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      )}

      {/* 100% Guarantee */}
      <section className="py-16 border-t border-gray-800">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-900/40 border-2 border-green-500 mb-6">
            <span className="text-3xl">✓</span>
          </div>
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
                body: "Can't get a refund to work for you? We'll go the extra mile and source you a replacement ticket to the game.",
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
