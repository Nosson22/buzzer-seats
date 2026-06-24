"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Countdown } from "@/components/ui/Countdown";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import StadiumMap from "@/components/StadiumMap";

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/listings/${id}`)
      .then((r) => r.json())
      .then(setListing);
  }, [id]);

  const handleBuyNow = async () => {
    if (!session) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/listings/${id}/buy`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Purchase failed");
      window.location.href = `/purchase-success?listingId=${id}`;
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
  const isLive = listing.status === "LIVE";

  return (
    <div className="max-w-3xl mx-auto">
      {/* Game info */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={isLive ? "green" : "yellow"}>
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

      {/* Stadium seat map */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
        <h2 className="font-bold text-lg mb-4">Your Seat Location</h2>
        <StadiumMap highlightSection={listing.section} />
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

      {/* Buy Now (buyer view) */}
      {!isSeller && isLive && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === "error" ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-green-900/30 text-green-400 border border-green-800"}`}>
              {message.text}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-black text-white">{formatCurrency(listing.askingPrice)}</p>
              <p className="text-xs text-gray-500">per ticket · {listing.quantity} available</p>
            </div>
            <Button onClick={handleBuyNow} loading={loading} className="text-lg px-8 py-4">
              Buy Now
            </Button>
          </div>
        </div>
      )}

      {listing.status === "SOLD" && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-sm text-gray-400 text-center">
          This ticket has been sold.
        </div>
      )}

      {listing.status === "DRAFT" && (
        <div className="bg-yellow-900/20 border border-yellow-800 rounded-xl p-4 text-sm text-yellow-400">
          This listing is not yet available for purchase.
        </div>
      )}
    </div>
  );
}
