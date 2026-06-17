/**
 * Notification Queue — schedules the "transfer your ticket now" alert
 * sent to sellers 30 minutes before their chosen live-trigger time.
 *
 * Timeline example (seller chose T_60):
 *   gameTime - 90 min  → notification fires → seller gets SMS/email
 *   gameTime - 60 min  → if seller forwarded ticket, listing is now LIVE
 *                         if not, listing stays DRAFT (no auto-activation)
 */
import { Queue } from "bullmq";
import { queueConnection } from "./redis";
import type { LiveTriggerType } from "@prisma/client";

export const NOTIFICATION_QUEUE = "seller-transfer-notification";

export interface NotificationJobData {
  listingId: string;
  sellerId: string;
  gameId: string;
  triggeredBy: LiveTriggerType;
}

let _notificationQueue: Queue<NotificationJobData> | null = null;
function getNotificationQueue(): Queue<NotificationJobData> {
  if (!_notificationQueue) {
    _notificationQueue = new Queue<NotificationJobData>(NOTIFICATION_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 3_000 },
        removeOnComplete: { age: 60 * 60 * 48 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    });
  }
  return _notificationQueue;
}
export const notificationQueue = new Proxy({} as Queue<NotificationJobData>, {
  get(_t, prop) { return (getNotificationQueue() as any)[prop]; },
});

/**
 * Milliseconds from first pitch for each trigger type.
 * Negative = before first pitch.
 */
const TRIGGER_OFFSET_MS: Record<LiveTriggerType, number> = {
  T_60: -60 * 60 * 1_000,
  T_30: -30 * 60 * 1_000,
  POST_START: 0,
};

/**
 * The notification fires 30 minutes BEFORE the seller's chosen trigger time,
 * giving them enough time to open the MLB Ballpark app and forward the ticket.
 */
const NOTIFICATION_LEAD_MS = 30 * 60 * 1_000;

/**
 * Schedule the "transfer your ticket now" notification for a draft listing.
 * Returns the BullMQ job ID (store it on the listing row).
 */
export async function scheduleTransferNotification(
  listingId: string,
  sellerId: string,
  gameId: string,
  trigger: LiveTriggerType,
  gameTime: Date
): Promise<string> {
  const triggerAt = gameTime.getTime() + TRIGGER_OFFSET_MS[trigger];
  const notifyAt = triggerAt - NOTIFICATION_LEAD_MS;
  const delayMs = Math.max(0, notifyAt - Date.now());

  const job = await notificationQueue.add(
    "notify",
    { listingId, sellerId, gameId, triggeredBy: trigger },
    {
      delay: delayMs,
      jobId: `notify_${listingId}`, // idempotent per listing
    }
  );

  return job.id!;
}

/** Cancel the notification job (call when seller cancels their draft). */
export async function cancelTransferNotification(jobId: string): Promise<void> {
  const job = await notificationQueue.getJob(jobId);
  if (!job) return;
  const state = await job.getState();
  if (state === "delayed" || state === "waiting") {
    await job.remove();
  }
}
