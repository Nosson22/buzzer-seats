"use client";
import { useState } from "react";
import Link from "next/link";

const buyerSteps = [
  {
    icon: "🔍",
    title: "Browse Upcoming Games",
    body: "Check the listings for any upcoming Marlins home game. Tickets are added by sellers days or even weeks in advance — you can browse early and watch for deals.",
  },
  {
    icon: "⏰",
    title: "Tickets Go Live at Game Time",
    body: "Tickets go live starting from 60 minutes before first pitch. That's when sellers drop their price and tickets become available to buy — so check back close to game time for the best deals.",
  },
  {
    icon: "⚡",
    title: "Grab It Before Someone Else Does",
    body: "Once a ticket goes live, anyone can buy it. These are last-minute prices — real discounts from sellers who need to move their tickets fast. Act quickly.",
  },
  {
    icon: "🤝",
    title: "Make an Offer",
    body: "See a ticket listed but want to pay less? Send the seller an offer. If they accept, the ticket is yours at your price. Sellers can counter, accept, or decline.",
  },
  {
    icon: "💳",
    title: "Pay Securely via Stripe",
    body: "Check out with your card through Stripe — the same payment processor used by Amazon, Uber, and millions of other sites. Your payment is encrypted and secure.",
  },
  {
    icon: "🎟️",
    title: "Receive Your Ticket",
    body: "Your ticket is transferred to you digitally through the MLB Ballpark app. You'll receive a notification and can use it to enter the stadium.",
  },
  {
    icon: "✅",
    title: "100% Guaranteed",
    body: "If anything goes wrong — your ticket doesn't arrive, there's an issue at the gate — you get a full refund, no questions asked. Or we'll find you a replacement seat so you still make the game.",
  },
];

const sellerSteps = [
  {
    icon: "📋",
    title: "Create an Account",
    body: "Sign up for a free account — it takes under a minute. The same account works for buying and selling. No need to choose one or the other.",
  },
  {
    icon: "📥",
    title: "List Your Ticket",
    body: "Enter your ticket details — section, row, seat numbers, and your asking price. Your listing is saved as a draft — nothing goes live yet. In the meantime, feel free to try selling it on StubHub, SeatGeek, or any other resale platform.",
  },
  {
    icon: "⏱",
    title: "Set Your Trigger",
    body: "Choose when you want your listing to go live — 60 minutes before the game, 30 minutes before, or right when the game starts. Once it goes live, you'll transfer the ticket to us, so you won't be selling it elsewhere at that point. But that's also when the serious last-minute buyers are shopping — and they're here.",
  },
  {
    icon: "🔔",
    title: "Get a 30-Minute Warning",
    body: "30 minutes before your chosen trigger time, we'll send you an alert. That's your signal to open the MLB Ballpark app and forward your ticket to our custody email. Once we receive it, your listing goes live automatically.",
  },
  {
    icon: "🔄",
    title: "Sell Elsewhere? Recall Instantly",
    body: "Sold on StubHub or gave the ticket to a friend? No problem. Hit Recall at any time and your listing is instantly removed — even if the window is already live. No penalty, no hassle.",
  },
  {
    icon: "💰",
    title: "Get Paid",
    body: "When a buyer purchases your ticket, Stripe processes the payment and you receive 85% of the sale price directly to your bank account. We take a 15% platform fee — that's it.",
  },
];

export default function HowItWorksPage() {
  const [tab, setTab] = useState<"buyer" | "seller">("buyer");
  const steps = tab === "buyer" ? buyerSteps : sellerSteps;

  return (
    <div className="max-w-3xl mx-auto py-16 px-4">
      <h1 className="text-4xl font-black text-white text-center mb-2">How It Works</h1>
      <p className="text-gray-400 text-center mb-10">
        Buzzer Seats connects last-minute sellers with buyers who want a deal.
      </p>

      {/* Toggle */}
      <div className="flex justify-center mb-12">
        <div className="flex bg-gray-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setTab("buyer")}
            className={`px-8 py-2.5 rounded-lg text-sm font-bold transition-all ${
              tab === "buyer"
                ? "text-white shadow"
                : "text-gray-400 hover:text-white"
            }`}
            style={tab === "buyer" ? { backgroundColor: "var(--marlins-blue)" } : {}}
          >
            I'm a Buyer
          </button>
          <button
            onClick={() => setTab("seller")}
            className={`px-8 py-2.5 rounded-lg text-sm font-bold transition-all ${
              tab === "seller"
                ? "text-white shadow"
                : "text-gray-400 hover:text-white"
            }`}
            style={tab === "seller" ? { backgroundColor: "var(--marlins-blue)" } : {}}
          >
            I'm a Seller
          </button>
        </div>
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-6">
        {steps.map((step, i) => (
          <div key={step.title} className="flex gap-5 bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm" style={{ backgroundColor: "var(--marlins-blue)" }}>
              {i + 1}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{step.icon}</span>
                <h3 className="font-bold text-white">{step.title}</h3>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-12 text-center">
        {tab === "buyer" ? (
          <>
            <p className="text-gray-400 mb-4">Ready to score a deal on tonight's game?</p>
            <Link
              href="/games"
              className="inline-block px-8 py-4 rounded-xl font-bold text-white text-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--marlins-blue)" }}
            >
              Browse Upcoming Games →
            </Link>
          </>
        ) : (
          <>
            <p className="text-gray-400 mb-4">Have tickets you can't use? Turn them into cash.</p>
            <Link
              href="/register?role=SELLER"
              className="inline-block px-8 py-4 rounded-xl font-bold text-white text-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--marlins-blue)" }}
            >
              Start Selling →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
