/**
 * MLB Automation Worker
 *
 * Processes accept-transfer and transfer-to-buyer jobs via AWS Device Farm.
 * Start this worker alongside the main app on Railway.
 *
 * On failure (Device Farm error, Appium script crash, timeout):
 *  - BullMQ retries up to 3 times with exponential backoff
 *  - After all retries exhausted, sends an alert email to admin
 */

import { Worker, Job } from "bullmq";
import { workerConnection } from "./redis";
import { MLB_AUTOMATION_QUEUE, MLBAutomationJobData } from "./mlb-automation.queue";
import { runMLBJob } from "../aws/device-farm";
import { prisma } from "../prisma";
import { sendAdminAlert } from "../email";
import { scheduleExpiry } from "./expiry.queue";
import { getTeamConfig } from "../team-config";
import { emitListingAvailable } from "../socket/emitters";

async function processJob(job: Job<MLBAutomationJobData>): Promise<void> {
  const { jobType, listingId, buyerEmail } = job.data;

  console.log(`[MLBWorker] Processing ${jobType} for listing ${listingId}`);

  const result = await runMLBJob(jobType, { listingId, buyerEmail });

  if (!result.success) {
    throw new Error(result.message); // BullMQ will retry
  }

  // After successful accept-transfer, mark LIVE and schedule expiry
  if (jobType === "accept-transfer") {
    const now = new Date();
    const listing = await prisma.listing.update({
      where: { id: listingId },
      data: { status: "LIVE", activatedAt: now },
      include: { game: { include: { team: true } } },
    });

    const { expiryOffsetMs } = getTeamConfig(listing.game.team.slug);
    const expiryAt = new Date(listing.game.gameTime.getTime() + expiryOffsetMs);
    const expiryJobId = await scheduleExpiry(listingId, listing.game.team.slug, expiryAt);
    await prisma.listing.update({ where: { id: listingId }, data: { expiryJobId } });

    emitListingAvailable(listing.game.id, {
      listingId,
      gameId: listing.game.id,
      section: listing.section,
      row: listing.row,
      seatNumbers: listing.seatNumbers,
      quantity: listing.quantity,
      askingPrice: listing.askingPrice,
      triggeredBy: listing.liveTriggerType,
      activatedAt: now.toISOString(),
    });

    console.log(`[MLBWorker] Listing ${listingId} marked LIVE after transfer accepted`);
  }

  // After successful transfer-to-buyer, mark the listing SOLD
  if (jobType === "transfer-to-buyer") {
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "SOLD", closedAt: new Date() },
    });
    console.log(`[MLBWorker] Listing ${listingId} marked SOLD after transfer to buyer`);
  }
}

async function handleFailure(job: Job<MLBAutomationJobData> | undefined, err: Error): Promise<void> {
  if (!job) return;

  const { jobType, listingId, buyerEmail } = job.data;
  const isExhausted = (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 3);

  if (isExhausted) {
    console.error(`[MLBWorker] ${jobType} exhausted retries for listing ${listingId}:`, err.message);

    // Alert admin so they can handle it manually
    await sendAdminAlert({
      subject: `⚠️ MLB Automation Failed: ${jobType}`,
      body: [
        `Job type: ${jobType}`,
        `Listing ID: ${listingId}`,
        buyerEmail ? `Buyer email: ${buyerEmail}` : "",
        `Error: ${err.message}`,
        ``,
        jobType === "accept-transfer"
          ? `Action needed: Manually accept the incoming ticket transfer in MLB Ballpark for deposits@buzzerseats.com`
          : `Action needed: Manually transfer ticket to ${buyerEmail} in MLB Ballpark for deposits@buzzerseats.com`,
      ].filter(Boolean).join("\n"),
    }).catch((e) => console.error("[MLBWorker] Failed to send admin alert:", e));
  }
}

export function startMLBAutomationWorker(): void {
  const worker = new Worker<MLBAutomationJobData>(
    MLB_AUTOMATION_QUEUE,
    processJob,
    {
      connection: queueConnection,
      concurrency: 1, // only one Device Farm session at a time
    }
  );

  worker.on("completed", (job) => {
    console.log(`[MLBWorker] Job ${job.id} (${job.data.jobType}) completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[MLBWorker] Job ${job?.id} (${job?.data.jobType}) failed:`, err.message);
    handleFailure(job, err);
  });

  console.log("[MLBWorker] MLB automation worker started");
}
