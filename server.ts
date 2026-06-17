/**
 * Custom Next.js server
 *
 * Mounts Socket.io on the same HTTP server as Next.js so that:
 *   - All Next.js routes work as normal
 *   - WebSocket upgrades on /api/socket are handled by Socket.io
 *
 * Start with: npx ts-node --project tsconfig.server.json server.ts
 * Or: NODE_ENV=production node dist/server.js  (after tsc build)
 */
import { createServer } from "http";
import next from "next";
import { initSocketServer } from "./lib/socket/server";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = parseInt(process.env.PORT ?? "3000");

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error("Error handling request:", err);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  // Attach Socket.io to the HTTP server
  const io = initSocketServer(httpServer);
  console.log(`[Server] Socket.io listening on path /api/socket`);

  httpServer.listen(port, hostname, () => {
    console.log(`[Server] Ready on http://${hostname}:${port}`);
    console.log(`[Server] Environment: ${dev ? "development" : "production"}`);
  });
});
