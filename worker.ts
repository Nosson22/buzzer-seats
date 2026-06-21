/**
 * Worker process — run this alongside the Next.js app on Railway.
 * Starts all BullMQ workers: expiry, notification, and MLB automation.
 *
 * Railway: add a second service pointing to this repo with start command:
 *   npx ts-node --project tsconfig.server.json worker.ts
 */
import { startMLBAutomationWorker } from "./lib/queue/mlb-automation.worker";

// Import the existing workers so they self-register
import "./lib/queue/expiry.worker";
import "./lib/queue/notification.worker";

startMLBAutomationWorker();

console.log("[Worker] All workers started");

// Keep process alive
process.on("SIGTERM", () => {
  console.log("[Worker] SIGTERM received, shutting down");
  process.exit(0);
});
