import Link from "next/link";

export default function CheckoutSuccessPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6">🎉</div>
        <h1 className="text-3xl font-black text-white mb-3">Payment Successful!</h1>
        <p className="text-gray-400 mb-2">
          Your tickets have been purchased. The seller will be notified and you&apos;ll receive the tickets electronically.
        </p>
        <p className="text-sm text-gray-500 mb-8">
          Check your email for a receipt from Stripe. Questions? Contact us.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/dashboard"
            className="px-6 py-3 rounded-xl font-bold text-white text-sm"
            style={{ backgroundColor: "var(--marlins-blue)" }}
          >
            View My Transactions
          </Link>
          <Link
            href="/games"
            className="px-6 py-3 rounded-xl font-bold text-white text-sm bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            Browse More Games
          </Link>
        </div>
      </div>
    </div>
  );
}
