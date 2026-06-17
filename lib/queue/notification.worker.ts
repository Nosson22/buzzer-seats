/**
 * Notification Worker
 *
 * Fires 30 minutes before the seller's chosen live-trigger time.
 * Sends a high-priority SMS (Twilio) + email telling the seller to
 * forward their ticket to deposits@buzzerseats.com RIGHT NOW.
 *
 * Start with:
 *   npx ts-node --project tsconfig.server.json lib/queue/notification.worker.ts
 */
import { Worker, Job } from "bullmq";
import { workerConnection } from "./redis";
import { NOTIFICATION_QUEUE, NotificationJobData } from "./notification.queue";
import { sendTransferNowAlert } from "../../services/notification.service";

const worker = new Worker<NotificationJobData>(
  NOTIFICATION_QUEUE,
  async (job: Job<NotificationJobData>) => {
    const { listingId, sellerId, triggeredBy } = job.data;
    console.log(`[NotificationWorker] Sending transfer alert for listing ${listingId} (trigger: ${triggeredBy})`);

    await sendTransferNowAlert(listingId, sellerId);

    console.log(`[NotificationWorker] Alert sent for listing ${listingId} ✓`);
  },
  {
    connection: workerConnection,
    concurrency: 20,
    stalledInterval: 30_000,
    maxStalledCount: 3,
  }
);

worker.on("completed", (job) => console.log(`[NotificationWorker] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[NotificationWorker] Job ${job?.id} failed:`, err.message));
worker.on("error", (err) => console.error("[NotificationWorker] Worker error:", err));

process.on("SIGTERM", async () => {
  console.log("[NotificationWorker] Shutting down...");
  await worker.close();
  process.exit(0);
});
