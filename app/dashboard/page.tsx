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
          ) : listings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
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

// ── Listing progress stepper ────────────────────────────────────────────────

function ListingCard({ listing }: { listing: any }) {
  const status = listing.status as string;
  const verStatus = listing.verificationStatus as string;
  const transferred = !!listing.custodyTransferredAt;

  // Determine terminal outcome
  const isSold = status === "SOLD";
  const isExpired = status === "EXPIRED";
  const isRejected = verStatus === "REJECTED";

  // Step states: "done" | "current" | "pending" | "rejected"
  const step1 = "done"; // always created
  const step2 = isRejected ? "rejected" : verStatus === "APPROVED" ? "done" : "current";
  const step3 = transferred ? "done" : verStatus === "APPROVED" ? "current" : "pending";
  const step4 = status === "LIVE" || isSold || isExpired ? "done" : transferred ? "current" : "pending";

  const steps = [
    { label: "Listing\nCreated", state: step1 },
    { label: "Approved", state: step2 },
    { label: "Ticket\nTransferred", state: step3 },
    { label: "Live", state: step4 },
  ];

  // Terminal badge after step 4
  let terminal: { label: string; color: string } | null = null;
  if (isSold) terminal = { label: "Sold", color: "#16a34a" };
  else if (isExpired) terminal = { label: "Not Sold", color: "#6b7280" };
  else if (isRejected) terminal = { label: "Rejected", color: "#dc2626" };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="font-bold text-white">{listing.game?.awayTeam} at {listing.game?.homeTeam}</p>
          <p className="text-sm text-gray-400 mt-0.5">{formatDate(listing.game?.gameTime)}</p>
          <p className="text-sm text-gray-400">Sec {listing.section} · Row {listing.row} · {listing.seatNumbers}</p>
        </div>
        <p className="font-black text-white text-lg shrink-0">{formatCurrency(listing.askingPrice)}</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center flex-1">
            {/* Node + label */}
            <div className="flex flex-col items-center">
              <StepCircle state={step.state} />
              <span className="text-center text-[10px] text-gray-400 mt-1.5 leading-tight whitespace-pre-line w-14">
                {step.label}
              </span>
            </div>
            {/* Connector line (not after last step) */}
            {i < steps.length - 1 && (
              <div className={`h-0.5 flex-1 mb-4 transition-colors ${
                step.state === "done" ? "bg-[var(--marlins-blue)]" : "bg-gray-700"
              }`} />
            )}
          </div>
        ))}

        {/* Terminal node */}
        {(isSold || isExpired) && (
          <div className="flex items-center flex-1">
            <div className={`h-0.5 flex-1 mb-4 ${step4 === "done" ? "bg-[var(--marlins-blue)]" : "bg-gray-700"}`} />
            <div className="flex flex-col items-center">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
                style={{ backgroundColor: terminal!.color + "22", border: `2px solid ${terminal!.color}` }}
              >
                {isSold ? "✓" : "–"}
              </div>
              <span className="text-[10px] mt-1.5 font-semibold" style={{ color: terminal!.color }}>
                {terminal!.label}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Rejection note */}
      {isRejected && listing.verificationNote && (
        <p className="text-xs text-red-400 mt-3 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
          Rejected: {listing.verificationNote}
        </p>
      )}
    </div>
  );
}

function StepCircle({ state }: { state: string }) {
  if (state === "done") {
    return (
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: "var(--marlins-blue)" }}>
        ✓
      </div>
    );
  }
  if (state === "current") {
    return (
      <div className="w-7 h-7 rounded-full border-2 flex items-center justify-center" style={{ borderColor: "var(--marlins-blue)" }}>
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--marlins-blue)" }} />
      </div>
    );
  }
  if (state === "rejected") {
    return (
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold bg-red-700 border-2 border-red-500">
        ✗
      </div>
    );
  }
  // pending
  return (
    <div className="w-7 h-7 rounded-full border-2 border-gray-600" />
  );
}

import { Suspense } from "react";
export default function DashboardPage() {
  return <Suspense><DashboardContent /></Suspense>;
}
