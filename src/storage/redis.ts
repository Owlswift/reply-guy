import Redis from "ioredis";
import { log } from "../utils/logger";

let client: Redis | null = null;

/**
 * Shared Redis client, lazily created and reused for the process lifetime.
 * Connects to REDIS_URL if set, otherwise the local default instance.
 */
export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      // Fail a queued command fast (default is 20 retries, ~10s) so the
      // fail-open callers in skippedImageTweets.ts don't stall the bot
      // for that long on every single tweet while Redis is unreachable.
      // The client keeps retrying the underlying connection in the
      // background regardless (governed by the default retryStrategy).
      maxRetriesPerRequest: 3,
    });
    // ioredis throws an unhandled exception (crashing the process) if a
    // connection error occurs with no 'error' listener attached — log
    // instead so callers can fail open (see skippedImageTweets.ts).
    client.on("error", err => log(`[Redis] connection error: ${err}`));
  }
  return client;
}
