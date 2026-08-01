import { getRedisClient } from "./redis";

/**
 * Authors whose posts have been found to be about forex and/or crypto
 * trading — a running record of who tends to post about those topics,
 * purely for later reference.
 *
 * Collected automatically as the main bot encounters tweets whose content
 * matches the forex/crypto vocabulary (decision/forexCryptoDetection.ts),
 * the same way storyTellerHandles.ts collects thread-posting authors.
 * Unlike TOP_PRIORITY_HANDLES/PRIORITY_HANDLES (decision/scoreTweet.ts),
 * nothing reads this set to drive a catch-up loop over these accounts
 * (compare catchupForexCrypto.ts, which does loop this list). It's just
 * collected — e.g. to look through by hand later and decide whether any
 * of them are worth promoting to an actual priority list.
 */
const REDIS_KEY = "echo:forex_crypto_handles";

export async function recordForexCryptoHandle(handle: string): Promise<void> {
  const normalized = handle.replace(/^@/, "").toLowerCase();
  if (!normalized) return;
  await getRedisClient().sadd(REDIS_KEY, normalized);
}

export async function getForexCryptoHandles(): Promise<string[]> {
  // Defensive filter — recordForexCryptoHandle() already guards against
  // saving a blank handle, but this SET predates that guard and a stray ""
  // entry sitting in it silently sent a catch-up scan to https://x.com/ (the
  // home timeline, not a profile) instead of erroring, which then treated
  // whatever random tweet it found there as if it belonged to the target
  // handle. Filtering here (and in runCatchup.ts's loop, as a second
  // backstop) means a blank entry can never resurface the same way again.
  const handles = await getRedisClient().smembers(REDIS_KEY);
  return handles.filter(h => h.trim().length > 0);
}