"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Tab = "verification" | "all" | "users" | "stats";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>("verification");
  const [note, setNote] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/");
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

  const loadUsers = () => {
    fetch("/api/admin/users").then((r) => r.json()).then(setUsers);
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
            { label: "Total Users", value: stats.totalUsers, tab: "users" as Tab },
            { label: "Pending Verification", value: stats.pendingVerification, highlight: stats.pendingVerification > 0, tab: "verification" as Tab },
            { label: "Completed Sales", value: stats.completedSales, tab: "stats" as Tab },
            { label: "Total Commission", value: formatCurrency(stats.totalCommission), tab: "stats" as Tab },
          ].map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setActiveTab(s.tab);
                if (s.tab === "users") loadUsers();
                if (s.tab === "verification") loadListings("PENDING");
              }}
              className={`bg-gray-900 border rounded-xl p-4 text-left transition-all hover:border-gray-600 ${s.highlight ? "border-yellow-700" : "border-gray-800"}`}
            >
              <p className="text-2xl font-black text-white">{s.value}</p>
              <p className="text-sm text-gray-400 mt-0.5">{s.label}</p>
              <p className="text-xs text-gray-600 mt-1">Click to view →</p>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 mb-6 w-fit flex-wrap">
        {([
          { key: "verification", label: "Verify Tickets" },
          { key: "all", label: "All Listings" },
          { key: "users", label: "Users" },
          { key: "stats", label: "Platform Stats" },
        ] as { key: Tab; label: string }[]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              if (tab.key === "verification") loadListings("PENDING");
              else if (tab.key === "all") loadListings();
              else if (tab.key === "users") loadUsers();
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key ? "bg-[var(--marlins-blue)] text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Verification / All Listings */}
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
                      <Button onClick={() => handleVerify(listing.id, "APPROVED")} size="sm">✓ Approve</Button>
                      <Button onClick={() => handleVerify(listing.id, "REJECTED")} size="sm" variant="danger">✗ Reject</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Users tab */}
      {activeTab === "users" && (
        <div className="space-y-3">
          {users.length === 0 && <div className="text-center py-12 text-gray-500">Loading users...</div>}
          {users.map((user) => (
            <button
              key={user.id}
              onClick={() => setSelectedUser(user)}
              className="w-full bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-2xl p-4 text-left transition-all flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ backgroundColor: "var(--marlins-blue)" }}>
                  {user.name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-white">{user.name}</p>
                  <p className="text-sm text-gray-400">{user.email}</p>
                  {user.phone && <p className="text-xs text-gray-500">{user.phone}</p>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="flex gap-2 justify-end mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${user.role === "ADMIN" ? "bg-purple-900/50 text-purple-300" : "bg-gray-800 text-gray-400"}`}>
                    {user.role}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{user._count.listings} listing{user._count.listings !== 1 ? "s" : ""} · {user._count.bids} bid{user._count.bids !== 1 ? "s" : ""}</p>
                <p className="text-xs text-gray-600">Joined {formatDate(user.createdAt)}</p>
              </div>
            </button>
          ))}
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

      {/* User detail drawer */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex" onClick={() => setSelectedUser(null)}>
          <div className="flex-1 bg-black/60" />
          <div
            className="w-full max-w-md bg-gray-950 border-l border-gray-800 overflow-y-auto h-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-black text-lg shrink-0" style={{ backgroundColor: "var(--marlins-blue)" }}>
                  {selectedUser.name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-black text-white text-lg leading-tight">{selectedUser.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${selectedUser.role === "ADMIN" ? "bg-purple-900/50 text-purple-300" : "bg-gray-800 text-gray-400"}`}>
                    {selectedUser.role}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedUser(null)} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
            </div>

            {/* Contact info */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 mb-6">
              <InfoRow label="Email" value={selectedUser.email} />
              <InfoRow label="Phone" value={selectedUser.phone || "—"} />
              <InfoRow label="Joined" value={formatDate(selectedUser.createdAt)} />
            </div>

            {/* Activity summary */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {[
                { label: "Listings", value: selectedUser._count.listings },
                { label: "Bids placed", value: selectedUser._count.bids },
                { label: "Purchases", value: selectedUser._count.buyerTransactions },
                { label: "Sales", value: selectedUser._count.sellerTransactions },
              ].map((s) => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xl font-black text-white">{s.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Listings */}
            {selectedUser.listings?.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-3">Recent Listings</p>
                <div className="space-y-2">
                  {selectedUser.listings.map((l: any) => {
                    const verColor = { APPROVED: "#16a34a", PENDING: "#ca8a04", REJECTED: "#dc2626" }[l.verificationStatus as string] ?? "#6b7280";
                    return (
                      <div key={l.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-white">{l.game?.awayTeam} at {l.game?.homeTeam}</p>
                            <p className="text-xs text-gray-400">Sec {l.section} · Row {l.row} · {l.seatNumbers}</p>
                            <p className="text-xs text-gray-500">{formatDate(l.game?.gameTime)}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-white">{formatCurrency(l.askingPrice)}</p>
                            <p className="text-xs mt-0.5" style={{ color: verColor }}>{l.verificationStatus}</p>
                            <p className="text-xs text-gray-600">{l.status}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm text-white font-medium">{value}</span>
    </div>
  );
}
