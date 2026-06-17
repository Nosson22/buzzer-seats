/**
 * Socket.io server singleton.
 *
 * This module is imported by the custom Next.js server (server.ts).
 * It is NOT imported directly by Next.js API routes because Next.js
 * route handlers run in a different context. Instead, API routes call
 * the `emit*` helper functions below which talk to the io instance
 * stored on the global object.
 */
import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  SOCKET_ROOMS,
} from "./events";

export type TypedIO = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const globalWithIO = globalThis as typeof globalThis & { _io?: TypedIO };

export function initSocketServer(httpServer: HttpServer): TypedIO {
  if (globalWithIO._io) return globalWithIO._io;

  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    path: "/api/socket",
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      methods: ["GET", "POST"],
    },
    // Prefer WebSockets; fall back to polling only for environments that need it
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on("game:subscribe", (gameId) => {
      socket.join(SOCKET_ROOMS.game(gameId));
    });

    socket.on("game:unsubscribe", (gameId) => {
      socket.leave(SOCKET_ROOMS.game(gameId));
    });

    socket.on("seller:subscribe", (sellerId) => {
      socket.join(SOCKET_ROOMS.seller(sellerId));
    });

    socket.on("disconnect", (reason) => {
      console.log(`[Socket] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  globalWithIO._io = io;
  return io;
}

export function getIO(): TypedIO | undefined {
  return globalWithIO._io;
}
