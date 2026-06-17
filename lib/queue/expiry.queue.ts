/**
 * Expiry Queue — schedules the post-game auto-expiry for LIVE unsold tickets.
 *
 * The delay is gameTime + team-specific offset (e.g. +30 min for MLB).
 * When the job fires, the worker flips LIVE → EXPIRED and emails the seller
 * their ticket transfer link so they don't lose their ticket.
 */
import { Queue } from "bullmq";
import { queueConnection } from "./redis";

export const EXPIRY_QUEUE = "ticket-expiry";

export interface ExpiryJobData {
  listingId: string;
  teamSlug: string;
}

export const expiryQueue = new Queue<ExpiryJobData>(EXPIRY_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 3_000 },
    removeOnComplete: { age: 60 * 60 * 48 },
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
});

/**
 * Schedule the expiry job for a listing that just went LIVE.
 * expiryAt = gameTime + team-specific offset (from getTeamConfig).
 * Returns BullMQ job ID — store on the listing row.
 */
export async function scheduleExpiry(
  listingId: string,
  teamSlug: string,
  expiryAt: Date
): Promise<string> {
  const delayMs = Math.max(0, expiryAt.getTime() - Date.now());

  const job = await expiryQueue.add(
    "expire",
    { listingId, teamSlug },
    {
      delay: delayMs,
      jobId: `expire_${listingId}`,
    }
  );

  return job.id!;
}

/** Cancel the expiry job (call when listing is SOLD before window closes). */
export async function cancelExpiry(jobId: string): Promise<void> {
  const job = await expiryQueue.getJob(jobId);
  if (!job) return;
  const state = await job.getState();
  if (state === "delayed" || state === "waiting") {
    await job.remove();
  }
}
