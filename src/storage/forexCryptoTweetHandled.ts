import { getRedisClient } from "./redis";

/**
 * catchup_forex_crypto's own record of tweets Echo has already decided
 * about (skipped OR replied) — same "id -> reason" shape as
 * storage/repliedTweets.ts, but Redis-backed and TTL'd, not a permanent
 * local JSON file.
 *
 * catchup_priority/catchup_stories stay on repliedTweets.ts's permanent
 * record — those are curated, lower-volume sources where "never revisit a
 * skip" is the right call. forex_crypto is a higher-volume,
 * auto-discovered list; a skip here only needs to hold for a day, not
 * forever, so this uses its own 24h-TTL'd HASH instead.
 *
 * TTL is refreshed on every write (Redis has no per-field HASH expiry,
 * only per-key), so this is a sliding 24h window on the whole record
 * rather than each tweet individually expiring 24h after its own write —
 * same tradeoff as storage/repliedUrls.ts.
 */
const REDIS_KEY = "echo:forex_crypto_handled_tweets";
const TTL_SECONDS = 24 * 60 * 60;

// Mirrors repliedTweets.ts's RETRYABLE_REASONS — a one-off failure (AI
// couldn't draft anything worth posting, operator missed the prompt
// window) shouldn't count as a real "skip this" decision.
const RETRYABLE_REASONS: string[] = [
  "operator chose to skip after AI generation failed to produce a valid reply",
];

export async function markForexCryptoTweetHandled(id: string, reason: string): Promise<void> {
  const client = getRedisClient();
  await client.hset(REDIS_KEY, id, reason);
  await client.expire(REDIS_KEY, TTL_SECONDS);
}

/** The reason this tweet was marked handled, if any — undefined if never marked. */
export async function getForexCryptoHandledReason(id: string): Promise<string | undefined> {
  const reason = await getRedisClient().hget(REDIS_KEY, id);
  return reason ?? undefined;
}

export async function isForexCryptoTweetHandled(id: string): Promise<boolean> {
  const reason = await getForexCryptoHandledReason(id);
  if (reason === undefined) return false;
  return !RETRYABLE_REASONS.includes(reason);
}
