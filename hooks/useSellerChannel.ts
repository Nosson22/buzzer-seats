/**
 * useSellerChannel — seller-side private notifications.
 *
 * Subscribes to the seller's private room so they receive:
 *   - recall:confirmed events (with the transfer token)
 */
"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ServerToClientEvents, ClientToServerEvents, RecallConfirmedPayload } from "@/lib/socket/events";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSellerChannel(sellerId: string | undefined) {
  const socketRef = useRef<TypedSocket | null>(null);
  const [recallConfirmation, setRecallConfirmation] = useState<RecallConfirmedPayload | null>(null);

  useEffect(() => {
    if (!sellerId) return;

    const socket: TypedSocket = io({ path: "/api/socket", transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("seller:subscribe", sellerId);
    });

    socket.on("recall:confirmed", (payload) => {
      setRecallConfirmation(payload);
    });

    return () => { socket.disconnect(); };
  }, [sellerId]);

  return { recallConfirmation };
}
