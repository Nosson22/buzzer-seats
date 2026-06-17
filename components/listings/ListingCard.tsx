"use client";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";

interface ListingCardProps {
  listing: {
    id: string;
    section: string;
    row: string;
    seatNumbers: string;
    quantity: number;
    askingPrice: number;
    description?: string | null;
    status: string;
    seller: { name: string };
    _count?: { bids: number };
  };
  showBidCount?: boolean;
}

export function ListingCard({ listing, showBidCount }: ListingCardProps) {
  const statusColor: Record<string, "green" | "yellow" | "gray" | "red"> = {
    DRAFT: "yellow",
    LIVE: "green",
    SOLD: "gray",
    EXPIRED: "red",
  };

  return (
    <Link href={`/listings/${listing.id}`} className="block">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-all hover:bg-gray-800/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-gray-400">Section {listing.section} · Row {listing.row}</p>
            <p className="font-semibold text-white mt-0.5">Seats {listing.seatNumbers}</p>
            <p className="text-sm text-gray-500 mt-1">{listing.quantity} ticket{listing.quantity > 1 ? "s" : ""}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xl font-black text-white">{formatCurrency(listing.askingPrice)}</p>
            <p className="text-xs text-gray-500">per ticket</p>
          </div>
        </div>

        {listing.description && (
          <p className="text-sm text-gray-400 mt-3 line-clamp-2">{listing.description}</p>
        )}

        <div className="flex items-center justify-between mt-4">
          <Badge variant={statusColor[listing.status] ?? "gray"}>{listing.status}</Badge>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {showBidCount && (
              <span>{listing._count?.bids ?? 0} bid{listing._count?.bids !== 1 ? "s" : ""}</span>
            )}
            <span>by {listing.seller.name}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
