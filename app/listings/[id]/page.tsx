"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Countdown } from "@/components/ui/Countdown";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const [listing, setListing] = useState<any>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/listings/${id}`)
      .then((r) => r.json())
      .then(setListing);
  }, [id]);

  const handleBid = async () => {
    if (!session) {
      window.location.href = "/login";
      return;
    }
    const amount = parseFloat(bidAmount);
    if (!amount || amount <= 0) {
      setMessage({ type: "error", text: "Enter a valid bid amount." });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/bids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: id, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bid failed");
      setMessage({ type: "success", text: "Bid placed! The seller will review all bids." });
      setBidAmount("");
      // Refresh listing
      fetch(`/api/listings/${id}`).then((r) => r.json()).then(setListing);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptBid = async (bidId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/accept`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Redirect to payment
      window.location.href = `/checkout?clientSecret=${data.clientSecret}&listingId=${id}`;
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!listing) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--marlins-blue)] border-t-transparent rounded-full" />
      </div>
    );
  }

  const isSeller = session?.user?.id === listing.sellerId;
  const isActive = listing.status === "ACTIVE";
  const inWindow = isActive;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Game info */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={isActive ? "green" : "yellow"}>
            {listing.status}
          </Badge>
          {listing.verificationStatus === "APPROVED" && <Badge variant="green">✓ Verified</Badge>}
        </div>
        <h1 className="text-2xl font-black text-white mb-1">
          {listing.game.awayTeam} at {listing.game.homeTeam}
        </h1>
        <p className="text-gray-400 text-sm">{listing.game.venue} · {formatDate(listing.game.gameTime)}</p>

        {(listing.game.status === "UPCOMING" || listing.game.status === "LIVE") && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <Countdown gameTime={listing.game.gameTime} />
          </div>
        )}
      </div>

      {/* Ticket details */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
        <h2 className="font-bold text-lg mb-4">Ticket Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Section</p>
            <p className="font-semibold text-white">{listing.section}</p>
          </div>
          <div>
            <p className="text-gray-500">Row</p>
            <p className="font-semibold text-white">{listing.row}</p>
          </div>
          <div>
            <p className="text-gray-500">Seats</p>
            <p className="font-semibold text-white">{listing.seatNumbers}</p>
          </div>
          <div>
            <p className="text-gray-500">Quantity</p>
            <p className="font-semibold text-white">{listing.quantity}</p>
          </div>
        </div>
        {listing.description && (
          <p className="mt-4 text-sm text-gray-400 pt-4 border-t border-gray-800">{listing.description}</p>
        )}
        <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-sm">Asking Price</p>
            <p className="text-3xl font-black text-white">{formatCurrency(listing.askingPrice)}</p>
            <p className="text-xs text-gray-500">per ticket</p>
          </div>
          <p className="text-sm text-gray-500">Listed by {listing.seller.name}</p>
        </div>
      </div>

      {/* Bids (seller view) */}
      {isSeller && listing.bids?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">Incoming Bids ({listing.bids.length})</h2>
          <div className="space-y-3">
            {listing.bids.map((bid: any) => (
              <div key={bid.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                <div>
                  <p className="font-semibold text-white">{formatCurrency(bid.amount)}</p>
                  <p className="text-sm text-gray-400">from {bid.bidder.name}</p>
                </div>
                {isActive && (
                  <Button size="sm" onClick={() => handleAcceptBid(bid.id)} loading={loading}>
                    Accept
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bid form (buyer view) */}
      {!isSeller && isActive && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          <h2 className="font-bold text-lg mb-1">Place a Bid</h2>
          <p className="text-sm text-gray-400 mb-4">
            Minimum bid: {formatCurrency(listing.askingPrice)} · Platform takes 15% commission on final sale
          </p>
          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === "error" ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-green-900/30 text-green-400 border border-green-800"}`}>
              {message.text}
            </div>
          )}
          <div className="flex gap-3">
            <Input
              type="number"
              placeholder={`Min ${listing.askingPrice}`}
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              min={listing.askingPrice}
              step="0.01"
              className="flex-1"
            />
            <Button onClick={handleBid} loading={loading}>
              Bid
            </Button>
          </div>
        </div>
      )}

      {!isActive && listing.status !== "SOLD" && (
        <div className="bg-yellow-900/20 border border-yellow-800 rounded-xl p-4 text-sm text-yellow-400">
          {listing.status === "INACTIVE"
            ? "This listing becomes available 1 hour before game time."
            : listing.status === "EXPIRED"
            ? "The buying window has closed for this game."
            : `This listing is ${listing.status.toLowerCase()}.`}
        </div>
      )}
    </div>
  );
}
