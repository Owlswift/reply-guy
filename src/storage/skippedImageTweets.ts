import { getRedisClient } from "./redis";

/**
 * Tracks tweet URLs skipped because they had image(s) attached (the
 * SKIP_IMAGE_TWEETS gate in main-interactive.ts). Checked before opening a
 * queued tweet so we never waste a navigation on one we already know has
 * an image and was skipped.
 */
const REDIS_KEY = "echo:skipped_image_tweets";

export async function markSkippedForImage(url: string): Promise<void> {
  await getRedisClient().sadd(REDIS_KEY, url);
}

export async function wasSkippedForImage(url: string): Promise<boolean> {
  const result = await getRedisClient().sismember(REDIS_KEY, url);
  return result === 1;
}
