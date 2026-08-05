import { getRedisClient } from "./redis";

/**
 * Authors whose posts have been found to be structurally part of a
 * multi-tweet thread — a running record of who tends to post that way,
 * purely for later reference.
 *
 * "Story teller" here means TweetDetails.isThread (extractTweet.ts) — true
 * if EITHER this tweet has an earlier same-author predecessor (backward
 * walk) OR later same-author segments were found and merged into fullText
 * (forward walk, the far more common case since Echo almost always
 * opens/replies to a thread's ROOT, not a later segment). NOT
 * ai/classifyTweet.ts's "story" text category — that one only matches
 * specific narrative-opener phrasing ("the other day", "this one time",
 * etc.) and has nothing to do with whether a post is actually part of a
 * thread.
 *
 * Unlike TOP_PRIORITY_HANDLES/PRIORITY_HANDLES (decision/scoreTweet.ts),
 * nothing reads this set to drive a catch-up loop over these accounts
 * (compare catchupPriorityHandles.ts, which does loop TOP_PRIORITY_HANDLES).
 * It's just collected — e.g. to look through by hand later and decide
 * whether any of them are worth promoting to an actual priority list.
 */
const REDIS_KEY = "echo:story_teller_handles";

export async function recordStoryTeller(handle: string): Promise<void> {
  const normalized = handle.replace(/^@/, "").toLowerCase();
  if (!normalized) return;
  await getRedisClient().sadd(REDIS_KEY, normalized);
}

export async function getStoryTellerHandles(): Promise<string[]> {
  // Defensive filter — recordStoryTeller() already guards against saving a
  // blank handle, but this SET predates that guard and a stray "" entry
  // sitting in it silently sent a catch-up scan to https://x.com/ (the
  // home timeline, not a profile) instead of erroring, which then treated
  // whatever random tweet it found there as if it belonged to the target
  // handle. Filtering here (and in runCatchup.ts's loop, as a second
  // backstop) means a blank entry can never resurface the same way again.
  const handles = await getRedisClient().smembers(REDIS_KEY);
  return handles.filter(h => h.trim().length > 0);
}

/**
 * Is this handle a known story teller? Used by reply/reply.ts's clickReply()
 * to decide whether a successful reply should also bump the daily per-handle
 * reply log (storage/dailyStoryTellerReplyStats.ts). Normalizes the same way
 * recordStoryTeller() does (strip leading @, lowercase) so a caller passing
 * "@WrittenBy_SS" and one passing "writtenby_ss" agree on the same answer.
 */
export async function isStoryTeller(handle: string): Promise<boolean> {
  const normalized = handle.replace(/^@/, "").toLowerCase();
  if (!normalized) return false;
  const result = await getRedisClient().sismember(REDIS_KEY, normalized);
  return result === 1;
}
