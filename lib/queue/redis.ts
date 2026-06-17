/**
 * BullMQ bundles its own copy of ioredis, so we pass plain connection option
 * objects rather than pre-built IORedis instances to avoid the version mismatch
 * that causes TS type conflicts between the two ioredis installs.
 */
import type { ConnectionOptions } from "bullmq";

const base = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT ?? "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
} satisfies ConnectionOptions;

/** For Workers: maxRetriesPerRequest MUST be null (BullMQ requirement). */
export const workerConnection: ConnectionOptions = {
  ...base,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/** For Queue / QueueEvents: normal retry behaviour is fine. */
export const queueConnection: ConnectionOptions = {
  ...base,
  maxRetriesPerRequest: null, // also null to satisfy BullMQ's Queue type
  enableReadyCheck: false,
};
