/**
 * Expiry Worker
 *
 * Fires at gameTime + team-specific offset (e.g. T+30 for MLB).
 * For every LIVE listing that hasn't sold:
 *   1. Flips status LIVE → EXPIRED
 *   2. Emails the seller a link to reclaim their ticket from our account
 *
 * Start with:
 *   npx ts-node --project tsconfig.server.json lib/queue/expiry.worker.ts
 */
import { Worker, Job } from "bullmq";
import { workerConnection } from "./redis";
import { EXPIRY_QUEUE, ExpiryJobData } from "./expiry.queue";
import { expireListing } from "../../services/expiry.service";

const worker = new Worker<ExpiryJobData>(
  EXPIRY_QUEUE,
  async (job: Job<ExpiryJobData>) => {
    const { listingId } = job.data;
    console.log(`[ExpiryWorker] Expiring listing ${listingId}`);

    try {
      await expireListing(listingId);
      console.log(`[ExpiryWorker] Listing ${listingId} → EXPIRED ✓`);
    } catch (err: any) {
      if (err.code === "LISTING_NOT_LIVE") {
        // Already sold or previously expired — clean no-op
        console.warn(`[ExpiryWorker] Listing ${listingId} was not LIVE (already sold?) — skipping.`);
        return;
      }
      throw err;
    }
  },
  {
    connection: workerConnection,
    concurrency: 20,
    stalledInterval: 30_000,
    maxStalledCount: 3,
  }
);

worker.on("completed", (job) => console.log(`[ExpiryWorker] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[ExpiryWorker] Job ${job?.id} failed:`, err.message));
worker.on("error", (err) => console.error("[ExpiryWorker] Worker error:", err));

process.on("SIGTERM", async () => {
  console.log("[ExpiryWorker] Shutting down...");
  await worker.close();
  process.exit(0);
});
