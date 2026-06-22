import type { ConnectionOptions } from "bullmq";

function getRedisBase(): Record<string, unknown> {
  const url = process.env.REDIS_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || "6379"),
      password: parsed.password || undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

const base = getRedisBase() as ConnectionOptions;

/** For Workers: maxRetriesPerRequest MUST be null (BullMQ requirement). */
export const workerConnection: ConnectionOptions = {
  ...base,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/** For Queue / QueueEvents: normal retry behaviour is fine. */
export const queueConnection: ConnectionOptions = {
  ...base,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};
