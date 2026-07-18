import { getRedisClient } from "./redis";

/**
 * Tweet URLs from LOW_PRIORITY_HANDLES (scoreTweet.ts) that were seen but
 * deliberately not engaged with yet — parked here instead of the normal
 * queue. Pulled back in only once the normal queue (top-priority, urgent,
 * everything else) is completely empty. See main-interactive.ts.
 */
const REDIS_KEY = "echo:low_priority_tweets";

export async function deferLowPriorityTweet(url: string): Promise<void> {
  await getRedisClient().sadd(REDIS_KEY, url);
}

export async function getDeferredLowPriorityTweets(limit: number): Promise<string[]> {
  return getRedisClient().srandmember(REDIS_KEY, limit);
}

export async function clearLowPriorityTweet(url: string): Promise<void> {
  await getRedisClient().srem(REDIS_KEY, url);
}
