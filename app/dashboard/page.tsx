"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

function DashboardContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [listings, setListings] = useState<any[]>([]);
  const [bids, setBids] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"listings" | "bids" | "transactions">("listings");
  const [connectStatus, setConnectStatus] = useState<any>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectMessage, setConnectMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    if (!session) return;
    const userId = session.user.id;

    fetch(`/api/listings?sellerId=${userId}`).then((r) => r.json()).then(setListings);
    fetch("/api/seller/connect").then((r) => r.json()).then(setConnectStatus);
    fetch("/api/bids?mine=true").then((r) => r.json()).then(setBids);
    fetch("/api/transactions").then((r) => r.json()).then(setTransactions);

    // Handle return from Stripe Connect onboarding
    if (searchParams.get("connect") === "success") {
      setConnectMessage("Your bank account is connected! You'll receive payouts automatically after each sale.");
      fetch("/api/seller/connect").then((r) => r.json()).then(setConnectStatus);
    }
  }, [session]);

  const handleConnect = async () => {
    setConnectLoading(true);
    const res = await fetch("/api/seller/connect", { method: "POST" });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else setConnectLoading(false);
  };

  const handleDelist = async (listingId: string) => {
    await fetch(`/api/listings/${listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delist" }),
    });
    setListings((prev) => prev.map((l) => l.id === listingId ? { ...l, status: "RECALLED" } : l));
  };

  if (status === "loading") {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-2 border-[var(--marlins-blue)] border-t-transparent rounded-full" /></div>;
  }

  const isSeller = true;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black text-white">Dashboard</h1>
        <p className="text-gray-400 mt-1">Welcome back, {session?.user?.name}</p>
      </div>

      {/* Stripe Connect banner for sellers */}
      {isSeller && (
        <div className="mb-6">
          {connectMessage && (
            <div className="bg-green-900/30 border border-green-800 rounded-xl p-4 text-sm text-green-400 mb-4">
              {connectMessage}
            </div>
          )}
          {connectStatus && !connectStatus.connected && (
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-white">Connect your bank to receive payouts</p>
                <p className="text-sm text-gray-400 mt-0.5">Set up your Stripe account so we can automatically send you 85% of every sale.</p>
              </div>
              <Button onClick={handleConnect} loading={connectLoading} className="shrink-0">
                Connect Bank →
              </Button>
            </div>
          )}
          {connectStatus?.connected && (
            <div className="bg-green-900/20 border border-green-800 rounded-xl p-3 flex items-center gap-3 text-sm text-green-400">
              <span>✓</span>
              <span>Bank account connected — payouts go out automatically after each sale.</span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 mb-6 w-fit">
        {(isSeller ? ["listings", "bids", "transactions"] as const : ["bids", "transactions"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              activeTab === tab ? "bg-[var(--marlins-blue)] text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Listings tab (sellers) */}
      {activeTab === "listings" && isSeller && (
        <div className="space-y-3">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">My Listings</h2>
            <Link href="/sell"><Button size="sm">+ New Listing</Button></Link>
          </div>
          {listings.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No listings yet.</p>
              <Link href="/sell" className="text-sm mt-2 block" style={{ color: "var(--marlins-blue)" }}>Create your first listing →</Link>
            </div>
          ) : listings.map((listing) => {
            const statusColor = { AVAILABLE: "green", DEPOSITED: "yellow", SOLD: "gray", RECALLED: "red" }[listing.status as string] as any;
            const verColor = { APPROVED: "green", PENDING: "yellow", REJECTED: "red" }[listing.verificationStatus as string] as any;
            return (
              <div key={listing.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate">{listing.game?.awayTeam} at {listing.game?.homeTeam}</p>
                  <p className="text-sm text-gray-400">Sec {listing.section} · Row {listing.row} · {listing.seatNumbers}</p>
                  <p className="text-sm text-gray-400">{formatDate(listing.game?.gameTime)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-white">{formatCurrency(listing.askingPrice)}</p>
                  <div className="flex gap-1 mt-1 justify-end">
                    <Badge variant={statusColor}>{listing.status}</Badge>
                    <Badge variant={verColor}>{listing.verificationStatus}</Badge>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bids tab */}
      {activeTab === "bids" && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold mb-4">My Bids</h2>
          {bids.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No bids placed yet.</p>
              <Link href="/games" className="text-sm mt-2 block" style={{ color: "var(--marlins-blue)" }}>Browse games →</Link>
            </div>
          ) : bids.map((bid) => {
            const statusColor = { PENDING: "yellow", ACCEPTED: "green", REJECTED: "red", EXPIRED: "gray" }[bid.status as string] as any;
            return (
              <div key={bid.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white">{bid.listing?.game?.awayTeam} at {bid.listing?.game?.homeTeam}</p>
                  <p className="text-sm text-gray-400">Sec {bid.listing?.section} · Row {bid.listing?.row}</p>
                  <p className="text-sm text-gray-400">{formatDate(bid.listing?.game?.gameTime)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-white">{formatCurrency(bid.amount)}</p>
                  <Badge variant={statusColor} className="mt-1">{bid.status}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Transactions tab */}
      {activeTab === "transactions" && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold mb-4">Transactions</h2>
          {transactions.length === 0 ? (
            <div className="text-center py-12 text-gray-500"><p>No transactions yet.</p></div>
          ) : transactions.map((tx) => {
            const isBuyer = tx.buyerId === session?.user?.id;
            const statusColor = { PENDING: "yellow", COMPLETED: "green", REFUNDED: "blue", FAILED: "red" }[tx.status as string] as any;
            return (
              <div key={tx.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-white">{tx.listing?.game?.awayTeam} at {tx.listing?.game?.homeTeam}</p>
                  <Badge variant={statusColor}>{tx.status}</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500">Your Role</p>
                    <p className="text-white font-medium">{isBuyer ? "Buyer" : "Seller"}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Sale Price</p>
                    <p className="text-white font-medium">{formatCurrency(tx.salePrice)}</p>
                  </div>
                  {!isBuyer && (
                    <>
                      <div>
                        <p className="text-gray-500">Commission (15%)</p>
                        <p className="text-red-400 font-medium">-{formatCurrency(tx.commissionAmount)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Your Payout</p>
                        <p className="text-green-400 font-medium">{formatCurrency(tx.sellerPayout)}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { Suspense } from "react";
export default function DashboardPage() {
  return <Suspense><DashboardContent /></Suspense>;
}
