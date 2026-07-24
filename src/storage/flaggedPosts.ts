import { getRedisClient } from "./redis";
import { log } from "../utils/logger";

/**
 * Posts from REVIEW_HANDLES (scoreTweet.ts) — skipped automatically instead
 * of replied to, but collected here rather than silently dropped like
 * BLOCKED_HANDLES, so the operator can go look at them by hand later. A
 * Redis LIST (not a set) so insertion order is preserved for numbering.
 */
const REDIS_KEY = "echo:flagged_for_review";

export async function flagPostForReview(url: string): Promise<void> {
  const client = getRedisClient();

  const existing = await client.lrange(REDIS_KEY, 0, -1);
  if (existing.includes(url)) return; // already flagged — don't duplicate or re-log

  await client.rpush(REDIS_KEY, url);
  const all = await client.lrange(REDIS_KEY, 0, -1);

  log(`[FlaggedForReview] Added a post (${all.length} total). Full list:`);
  console.log(all.map((u, i) => `   ${i + 1}. ${u}`).join("\n"));
}

export async function getFlaggedPosts(): Promise<string[]> {
  return getRedisClient().lrange(REDIS_KEY, 0, -1);
}
