import { getRedisClient } from "./redis";
import { log } from "../utils/logger";

/**
 * Tweet URLs from LOW_PRIORITY_HANDLES (scoreTweet.ts) that were seen but
 * deliberately not engaged with yet — parked here instead of the normal
 * queue. Pulled back in only once the normal queue (top-priority, urgent,
 * everything else) is completely empty. See main-interactive.ts.
 */
const REDIS_KEY = "echo:low_priority_tweets";

export async function deferLowPriorityTweet(url: string): Promise<void> {
  const added = await getRedisClient().sadd(REDIS_KEY, url);
  if (added === 0) return; // already cached, not a new entry

  const all = await getRedisClient().smembers(REDIS_KEY);
  log(`[LowPriority] Cached new tweet (${all.length} total):`);
  console.log(all.map(u => `   - ${u}`).join("\n"));
}

export async function getDeferredLowPriorityTweets(limit: number): Promise<string[]> {
  return getRedisClient().srandmember(REDIS_KEY, limit);
}

export async function clearLowPriorityTweet(url: string): Promise<void> {
  await getRedisClient().srem(REDIS_KEY, url);
}
