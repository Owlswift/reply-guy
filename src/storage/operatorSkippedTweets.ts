import { getRedisClient } from "./redis";

/**
 * Tracks tweet IDs the operator explicitly chose to skip when prompted
 * (see decision/posterProfiles.ts's ALWAYS_PROMPT_HANDLES). Checked before
 * opening a queued tweet so a post that was skipped once is never
 * re-prompted or re-queued.
 */
const REDIS_KEY = "echo:operator_skipped_tweets";

export async function markSkippedByOperator(id: string): Promise<void> {
  await getRedisClient().sadd(REDIS_KEY, id);
}

export async function wasSkippedByOperator(id: string): Promise<boolean> {
  const result = await getRedisClient().sismember(REDIS_KEY, id);
  return result === 1;
}
