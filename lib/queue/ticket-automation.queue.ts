import { Queue } from "bullmq";
import { queueConnection } from "./redis";

export const TICKET_AUTOMATION_QUEUE = "ticket-automation";

export interface TicketAutomationJobData {
  jobType: "transfer-to-buyer";
  listingId: string;
  buyerEmail?: string;
}

let _queue: Queue<TicketAutomationJobData> | null = null;

function getQueue(): Queue<TicketAutomationJobData> {
  if (!_queue) {
    _queue = new Queue<TicketAutomationJobData>(TICKET_AUTOMATION_QUEUE, {
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

export const ticketAutomationQueue = new Proxy({} as Queue<TicketAutomationJobData>, {
  get(_t, prop) { return (getQueue() as any)[prop]; },
});

export async function scheduleTransferToBuyer(listingId: string, buyerEmail: string): Promise<void> {
  await ticketAutomationQueue.add("transfer-to-buyer", { jobType: "transfer-to-buyer", listingId, buyerEmail });
  console.log(`[TicketQueue] Queued transfer-to-buyer for listing ${listingId} → ${buyerEmail}`);
}
