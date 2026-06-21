import { Queue } from "bullmq";
import { queueConnection } from "./redis";

export const MLB_AUTOMATION_QUEUE = "mlb-automation";

export interface MLBAutomationJobData {
  jobType: "accept-transfer" | "transfer-to-buyer";
  listingId: string;
  buyerEmail?: string;
}

let _queue: Queue<MLBAutomationJobData> | null = null;

function getQueue(): Queue<MLBAutomationJobData> {
  if (!_queue) {
    _queue = new Queue<MLBAutomationJobData>(MLB_AUTOMATION_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 60 * 60 * 48 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    });
  }
  return _queue;
}

export const mlbAutomationQueue = new Proxy({} as Queue<MLBAutomationJobData>, {
  get(_t, prop) { return (getQueue() as any)[prop]; },
});

export async function scheduleAcceptTransfer(listingId: string): Promise<void> {
  await mlbAutomationQueue.add("accept-transfer", { jobType: "accept-transfer", listingId });
  console.log(`[MLBQueue] Queued accept-transfer for listing ${listingId}`);
}

export async function scheduleTransferToBuyer(listingId: string, buyerEmail: string): Promise<void> {
  await mlbAutomationQueue.add("transfer-to-buyer", { jobType: "transfer-to-buyer", listingId, buyerEmail });
  console.log(`[MLBQueue] Queued transfer-to-buyer for listing ${listingId} → ${buyerEmail}`);
}
