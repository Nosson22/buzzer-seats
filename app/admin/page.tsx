"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"verification" | "all" | "stats">("verification");
  const [note, setNote] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.push("/");
    }
    if (status === "unauthenticated") router.push("/login");
  }, [status, session]);

  useEffect(() => {
    if (session?.user?.role !== "ADMIN") return;
    fetch("/api/admin/stats").then((r) => r.json()).then(setStats);
    loadListings("PENDING");
  }, [session]);

  const loadListings = (verificationStatus?: string) => {
    const qs = verificationStatus ? `?verificationStatus=${verificationStatus}` : "";
    fetch(`/api/admin/listings${qs}`).then((r) => r.json()).then(setListings);
  };

  const handleVerify = async (listingId: string, decision: "APPROVED" | "REJECTED") => {
    await fetch(`/api/listings/${listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verificationStatus: decision, verificationNote: note[listingId] || "" }),
    });
    setListings((prev) => prev.filter((l) => l.id !== listingId));
  };

  if (status === "loading" || session?.user?.role !== "ADMIN") {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-2 border-[var(--marlins-blue)] border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-3xl font-black text-white">Admin Panel</h1>
        <a href="/admin/2fa" className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded-lg px-3 py-1.5 transition-colors">🔐 Set up 2FA</a>
      </div>
      <p className="text-gray-400 mb-8">Manage listings, verify tickets, and monitor platform activity.</p>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Users", value: stats.totalUsers },
            { label: "Pending Verification", value: stats.pendingVerification, highlight: stats.pendingVerification > 0 },
            { label: "Completed Sales", value: stats.completedSales },
            { label: "Total Commission", value: formatCurrency(stats.totalCommission) },
          ].map((s) => (
            <div key={s.label} className={`bg-gray-900 border rounded-xl p-4 ${s.highlight ? "border-yellow-700" : "border-gray-800"}`}>
              <p className="text-2xl font-black text-white">{s.value}</p>
              <p className="text-sm text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 mb-6 w-fit">
        {(["verification", "all", "stats"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              if (tab === "verification") loadListings("PENDING");
              else if (tab === "all") loadListings();
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              activeTab === tab ? "bg-[var(--marlins-blue)] text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {tab === "verification" ? "Verify Tickets" : tab === "all" ? "All Listings" : "Platform Stats"}
          </button>
        ))}
      </div>

      {/* Verification queue */}
      {(activeTab === "verification" || activeTab === "all") && (
        <div className="space-y-4">
          {listings.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              {activeTab === "verification" ? "No tickets pending verification. 🎉" : "No listings found."}
            </div>
          )}
          {listings.map((listing) => {
            const verColor = { APPROVED: "green", PENDING: "yellow", REJECTED: "red" }[listing.verificationStatus as string] as any;
            return (
              <div key={listing.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={verColor}>{listing.verificationStatus}</Badge>
                      <Badge variant="gray">{listing.status}</Badge>
                    </div>
                    <h3 className="font-bold text-white">{listing.game?.awayTeam} at {listing.game?.homeTeam}</h3>
                    <p className="text-sm text-gray-400">{formatDate(listing.game?.gameTime)}</p>
                    <p className="text-sm text-gray-400 mt-1">Sec {listing.section} · Row {listing.row} · Seats {listing.seatNumbers} · {listing.quantity}x tickets</p>
                    <p className="text-sm text-gray-400">Asking: {formatCurrency(listing.askingPrice)} · Seller: {listing.seller?.name} ({listing.seller?.email})</p>
                    {listing.barcodeNumber && (
                      <div className="mt-2 inline-flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
                        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Barcode</span>
                        <span className="font-mono text-sm text-white font-bold">{listing.barcodeNumber}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xl font-black text-white shrink-0">{formatCurrency(listing.askingPrice)}</p>
                </div>

                {/* Verification images */}
                {listing.verificationImages?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">Ticket Images</p>
                    <div className="flex gap-2 flex-wrap">
                      {listing.verificationImages.map((url: string, i: number) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt={`Ticket image ${i + 1}`} className="h-24 w-auto rounded-lg border border-gray-700 hover:border-gray-500 transition-colors object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Admin actions */}
                {listing.verificationStatus === "PENDING" && (
                  <div className="border-t border-gray-800 pt-4">
                    <textarea
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 resize-none mb-3"
                      rows={2}
                      placeholder="Optional note to seller..."
                      value={note[listing.id] || ""}
                      onChange={(e) => setNote({ ...note, [listing.id]: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button onClick={() => handleVerify(listing.id, "APPROVED")} size="sm">
                        ✓ Approve
                      </Button>
                      <Button onClick={() => handleVerify(listing.id, "REJECTED")} size="sm" variant="danger">
                        ✗ Reject
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Platform stats tab */}
      {activeTab === "stats" && stats && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-bold text-white mb-4">Listing Breakdown by Status</h2>
            <div className="space-y-2">
              {stats.listings.map((row: any) => (
                <div key={row.status} className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">{row.status}</span>
                  <span className="font-semibold text-white">{row._count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="font-bold text-white mb-4">Revenue</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-400 text-sm">Gross Ticket Sales</p>
                <p className="text-2xl font-black text-white">{formatCurrency(stats.totalRevenue)}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">Platform Commission (15%)</p>
                <p className="text-2xl font-black text-green-400">{formatCurrency(stats.totalCommission)}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
