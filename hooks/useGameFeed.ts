/**
 * useGameFeed — buyer-side real-time listing feed.
 *
 * Connects to the Socket.io server, subscribes to a game room,
 * and maintains a local listing map that updates instantly on
 * listing:available, listing:recalled, and listing:sold events.
 */
"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ListingAvailablePayload,
} from "@/lib/socket/events";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface FeedListing extends ListingAvailablePayload {
  status: "AVAILABLE" | "RECALLED" | "SOLD";
}

export function useGameFeed(gameId: string) {
  const socketRef = useRef<TypedSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [listings, setListings] = useState<Map<string, FeedListing>>(new Map());

  const removeListing = useCallback((listingId: string) => {
    setListings((prev) => {
      const next = new Map(prev);
      next.delete(listingId);
      return next;
    });
  }, []);

  useEffect(() => {
    const socket: TypedSocket = io({
      path: "/api/socket",
      transports: ["websocket"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("game:subscribe", gameId);
    });

    socket.on("disconnect", () => setConnected(false));

    // A new listing just went live — add it to the map
    socket.on("listing:available", (payload) => {
      setListings((prev) => {
        const next = new Map(prev);
        next.set(payload.listingId, { ...payload, status: "AVAILABLE" });
        return next;
      });
    });

    // Seller recalled — instantly remove from the buyer's feed
    socket.on("listing:recalled", ({ listingId }) => {
      removeListing(listingId);
    });

    // Sold — remove or mark as sold based on your UI preference
    socket.on("listing:sold", ({ listingId }) => {
      setListings((prev) => {
        const next = new Map(prev);
        const existing = next.get(listingId);
        if (existing) next.set(listingId, { ...existing, status: "SOLD" });
        return next;
      });
    });

    return () => {
      socket.emit("game:unsubscribe", gameId);
      socket.disconnect();
    };
  }, [gameId, removeListing]);

  return {
    connected,
    listings: Array.from(listings.values()).filter((l) => l.status === "AVAILABLE"),
  };
}
