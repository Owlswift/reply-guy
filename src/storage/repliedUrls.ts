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
 */
const REDIS_KEY = "echo:replied_urls";

export async function markUrlReplied(url: string): Promise<void> {
  await getRedisClient().sadd(REDIS_KEY, url);
}

export async function hasUrlBeenReplied(url: string): Promise<boolean> {
  const result = await getRedisClient().sismember(REDIS_KEY, url);
  return result === 1;
}
