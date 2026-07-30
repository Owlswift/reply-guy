import { getRedisClient } from "./redis";
import { TimelineTweet } from "../types/tweet";

/**
 * Backs the notifications scanner's incremental scan. Two structures because
 * "have we seen this" and "do we still need to act on it" have different
 * lifetimes:
 *
 * - SEEN_KEY (a set) is written once, the moment a qualifying reply
 *   notification is discovered, and never removed. The notifications feed
 *   is strictly newest-first and every scan starts from the top, so hitting
 *   an id already in this set means everything older was already discovered
 *   on a prior run — the scanner uses it to stop scrolling early instead of
 *   walking the full lookback window every time.
 * - PENDING_KEY (a hash) holds the same discovered candidates but gets an
 *   entry removed once notifications.ts has fully handled it (replied,
 *   liked, ended, skipped, or ruled out as not really a reply to Echo). This
 *   is the actual work queue: a run that gets interrupted mid-processing
 *   leaves its leftovers here for the next run to pick up before scanning.
 */
const SEEN_KEY = "echo:seen_reply_notifications";
const PENDING_KEY = "echo:pending_reply_notifications";

export async function wasReplyNotificationDiscovered(id: string): Promise<boolean> {
  const result = await getRedisClient().sismember(SEEN_KEY, id);
  return result === 1;
}

export async function markReplyNotificationDiscovered(candidate: TimelineTweet): Promise<void> {
  const client = getRedisClient();
  await client.sadd(SEEN_KEY, candidate.id);
  await client.hset(PENDING_KEY, candidate.id, JSON.stringify(candidate));
}

export async function getPendingReplyNotifications(): Promise<TimelineTweet[]> {
  const raw = await getRedisClient().hgetall(PENDING_KEY);
  return Object.values(raw)
    .map((json) => {
      const parsed = JSON.parse(json);
      return { ...parsed, createdAt: new Date(parsed.createdAt) } as TimelineTweet;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function clearPendingReplyNotification(id: string): Promise<void> {
  await getRedisClient().hdel(PENDING_KEY, id);
}
