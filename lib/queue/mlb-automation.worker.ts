/**
 * MLB Automation Worker
 *
 * Processes transfer-to-buyer jobs via AWS Device Farm.
 * (Accept-transfer is handled automatically via Postmark inbound email → /api/inbound/email)
 *
 * On failure: BullMQ retries up to 3 times with exponential backoff,
 * then sends an admin alert email.
 */

import { Worker, Job } from "bullmq";
import { workerConnection } from "./redis";
import { MLB_AUTOMATION_QUEUE, MLBAutomationJobData } from "./mlb-automation.queue";
import { runMLBJob } from "../aws/device-farm";
import { prisma } from "../prisma";
import { sendAdminAlert } from "../email";

async function processJob(job: Job<MLBAutomationJobData>): Promise<void> {
  const { jobType, listingId, buyerEmail } = job.data;

  if (jobType !== "transfer-to-buyer") {
    console.warn(`[MLBWorker] Unexpected job type: ${jobType} — skipping`);
    return;
  }

  console.log(`[MLBWorker] Processing transfer-to-buyer for listing ${listingId} → ${buyerEmail}`);

  const result = await runMLBJob("transfer-to-buyer", { listingId, buyerEmail });

  if (!result.success) {
    throw new Error(result.message); // BullMQ will retry
  }

  await prisma.listing.update({
    where: { id: listingId },
    data: { status: "SOLD", closedAt: new Date() },
  });

  console.log(`[MLBWorker] Listing ${listingId} marked SOLD after transfer to buyer`);
}

async function handleFailure(job: Job<MLBAutomationJobData> | undefined, err: Error): Promise<void> {
  if (!job) return;

  const { jobType, listingId, buyerEmail } = job.data;
  const isExhausted = (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 3);

  if (isExhausted) {
    console.error(`[MLBWorker] ${jobType} exhausted retries for listing ${listingId}:`, err.message);
    await sendAdminAlert({
      subject: `⚠️ MLB Transfer Failed: transfer-to-buyer`,
      body: [
        `Listing ID: ${listingId}`,
        `Buyer email: ${buyerEmail ?? "unknown"}`,
        `Error: ${err.message}`,
        ``,
        `Action needed: Manually transfer ticket to ${buyerEmail} in MLB Ballpark app (deposits@buzzerseats.com)`,
      ].join("\n"),
    }).catch((e) => console.error("[MLBWorker] Failed to send admin alert:", e));
  }
}

export function startMLBAutomationWorker(): void {
  const worker = new Worker<MLBAutomationJobData>(
    MLB_AUTOMATION_QUEUE,
    processJob,
    {
      connection: workerConnection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[MLBWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[MLBWorker] Job ${job?.id} failed:`, err.message);
    handleFailure(job, err);
  });

  console.log("[MLBWorker] MLB automation worker started (transfer-to-buyer only)");
}
