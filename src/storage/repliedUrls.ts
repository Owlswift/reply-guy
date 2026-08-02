import { getRedisClient } from "./redis";

/**
 * A dedicated, Redis-backed record of tweet URLs Echo has actually posted a
 * reply to — checked immediately before opening ANY tweet, as the last
 * line of defense against replying to the same post twice.
 *
 * Why this exists alongside repliedTweets.ts/seenNotifications.ts: those
 * are real, but repliedTweets.ts loads its cache into memory ONCE per
 * process and never re-reads it — if two Echo processes ever run at the
 * same time (this has happened more than once this session, e.g. during
 * the ensure-running.sh restart-loop confusion), each process has its own
 * stale in-memory snapshot and neither one can see the other's replies,
 * so both can reply to the same tweet independently. That's the most
 * likely explanation for the same-post-replied-to-twice reports.
 *
 * Redis has no such per-process caching problem — every check/write goes
 * to the shared server directly, so two processes (or two runs, restarted
 * moments apart) always see the same, current state.
 *
 * 24h TTL, refreshed on every write — Redis has no per-member expiry for a
 * SET, only per-key, so this is a sliding window on the whole set rather
 * than each URL individually expiring 24h after its own addition. Fine for
 * what this guards against (replying to the same post twice within the
 * same run or a near-concurrent restart) — it just stops the set from
 * growing forever.
 */
const REDIS_KEY = "echo:replied_urls";
const TTL_SECONDS = 24 * 60 * 60;

export async function markUrlReplied(url: string): Promise<void> {
  const client = getRedisClient();
  await client.sadd(REDIS_KEY, url);
  await client.expire(REDIS_KEY, TTL_SECONDS);
}

export async function hasUrlBeenReplied(url: string): Promise<boolean> {
  const result = await getRedisClient().sismember(REDIS_KEY, url);
  return result === 1;
}
