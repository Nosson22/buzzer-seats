/**
 * Ticket Automation Worker
 *
 * Dispatches transfer-to-buyer jobs to the correct platform based on
 * the team's ticketPlatform field:
 *   MLB          → mlb.tickets.com (Playwright)
 *   TICKETMASTER → am.ticketmaster.com (Playwright)
 *   SEATGEEK     → seatgeek.com (Playwright)
 *
 * BullMQ retries up to 3× with exponential backoff, then sends an admin alert.
 */

import { Worker, Job } from "bullmq";
import { workerConnection } from "./redis";
import { TICKET_AUTOMATION_QUEUE, TicketAutomationJobData } from "./ticket-automation.queue";
import { transferTicketToBuyer as transferMLB } from "../playwright/transfer-to-buyer";
import { transferTicketToBuyerTM } from "../playwright/ticketmaster-transfer";
import { transferTicketToBuyerSG } from "../playwright/seatgeek-transfer";
import { getTMAuthenticatedContext } from "../playwright/ticketmaster-session";
import { prisma } from "../prisma";
import { sendAdminAlert } from "../email";

async function processJob(job: Job<TicketAutomationJobData>): Promise<void> {
  const { jobType, listingId, buyerEmail } = job.data;

  if (jobType === "test-tm-login") {
    const key = listingId; // reused as the ping key
    const start = Date.now();
    try {
      const { close } = await getTMAuthenticatedContext("heat");
      const elapsedMs = Date.now() - start;
      await close();
      await prisma.workerPing.upsert({
        where: { key },
        create: { key, ok: true, message: "Ticketmaster login successful", elapsedMs },
        update: { ok: true, message: "Ticketmaster login successful", elapsedMs, createdAt: new Date() },
      });
      console.log(`[TicketWorker] test-tm-login OK in ${elapsedMs}ms`);
    } catch (err: any) {
      const elapsedMs = Date.now() - start;
      await prisma.workerPing.upsert({
        where: { key },
        create: { key, ok: false, message: err?.message ?? "Unknown error", elapsedMs },
        update: { ok: false, message: err?.message ?? "Unknown error", elapsedMs, createdAt: new Date() },
      });
      console.error(`[TicketWorker] test-tm-login FAILED:`, err?.message);
    }
    return;
  }

  if (jobType !== "transfer-to-buyer") {
    console.warn(`[TicketWorker] Unexpected job type: ${jobType} — skipping`);
    return;
  }

  if (!buyerEmail) throw new Error("buyerEmail is required");

  const listing = await prisma.listing.findUniqueOrThrow({
    where: { id: listingId },
    select: {
      section: true,
      row: true,
      seatNumbers: true,
      game: { select: { team: { select: { slug: true, ticketPlatform: true } } } },
    },
  });

  const { slug: teamSlug, ticketPlatform } = listing.game.team;
  console.log(`[TicketWorker] Transfer-to-buyer: listing=${listingId} team=${teamSlug} platform=${ticketPlatform} → ${buyerEmail}`);

  let result: { success: boolean; message: string };

  if (ticketPlatform === "MLB") {
    result = await transferMLB({
      section: listing.section,
      row: listing.row,
      seatNumbers: listing.seatNumbers,
      buyerEmail,
    });
  } else if (ticketPlatform === "TICKETMASTER") {
    result = await transferTicketToBuyerTM({
      teamSlug,
      section: listing.section,
      row: listing.row,
      seatNumbers: listing.seatNumbers,
      buyerEmail,
    });
  } else if (ticketPlatform === "SEATGEEK") {
    result = await transferTicketToBuyerSG({
      section: listing.section,
      row: listing.row,
      seatNumbers: listing.seatNumbers,
      buyerEmail,
    });
  } else {
    throw new Error(`Unknown ticketPlatform: ${ticketPlatform}`);
  }

  if (!result.success) {
    throw new Error(result.message);
  }

  await prisma.listing.update({
    where: { id: listingId },
    data: { status: "SOLD", closedAt: new Date() },
  });

  console.log(`[TicketWorker] Listing ${listingId} marked SOLD after transfer to ${buyerEmail}`);
}

async function handleFailure(job: Job<TicketAutomationJobData> | undefined, err: Error): Promise<void> {
  if (!job) return;

  const { listingId, buyerEmail } = job.data;
  const isExhausted = (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 3);

  if (isExhausted) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { game: { select: { team: { select: { name: true, ticketPlatform: true } } } } },
    }).catch(() => null);

    const platform = listing?.game.team.ticketPlatform ?? "unknown";
    const teamName = listing?.game.team.name ?? "unknown";

    await sendAdminAlert({
      subject: `⚠️ Ticket Transfer Failed: ${teamName}`,
      body: [
        `Listing ID: ${listingId}`,
        `Buyer email: ${buyerEmail ?? "unknown"}`,
        `Team: ${teamName}`,
        `Platform: ${platform}`,
        `Error: ${err.message}`,
        ``,
        `Action needed: Manually transfer ticket to ${buyerEmail} via the ${platform} account.`,
      ].join("\n"),
    }).catch((e) => console.error("[TicketWorker] Failed to send admin alert:", e));
  }
}

export function startTicketAutomationWorker(): void {
  const worker = new Worker<TicketAutomationJobData>(
    TICKET_AUTOMATION_QUEUE,
    processJob,
    { connection: workerConnection, concurrency: 1 }
  );

  worker.on("completed", (job) => console.log(`[TicketWorker] Job ${job.id} completed`));
  worker.on("failed", (job, err) => {
    console.error(`[TicketWorker] Job ${job?.id} failed:`, err.message);
    handleFailure(job, err);
  });

  console.log("[TicketWorker] Ticket automation worker started (MLB + Ticketmaster + SeatGeek)");
}
