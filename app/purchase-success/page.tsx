"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function PurchaseSuccessPage() {
  const params = useSearchParams();
  const listingId = params.get("listingId");

  return (
    <div className="max-w-lg mx-auto text-center py-20">
      <div className="text-6xl mb-6">🎉</div>
      <h1 className="text-3xl font-black text-white mb-4">You&apos;re going to the game!</h1>
      <p className="text-gray-400 mb-2">
        Your ticket is being transferred to your MLB Ballpark account right now.
      </p>
      <p className="text-gray-400 mb-8">
        Check your MLB Ballpark app — you&apos;ll receive the ticket within a few minutes.
      </p>
      <Link
        href="/dashboard"
        className="inline-block bg-[var(--marlins-blue)] text-white font-bold px-8 py-3 rounded-xl hover:opacity-90 transition"
      >
        View My Tickets
      </Link>
    </div>
  );
}
