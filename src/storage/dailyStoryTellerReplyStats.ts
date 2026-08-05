import { getRedisClient } from "./redis";

/**
 * Daily reply counts bucketed by story-teller handle, persisted in Redis so
 * the counts survive process restarts. A single Redis hash
 * (echo:story_teller_replies_per_day), one field per "YYYY-MM-DD:handle"
 * (e.g. "2026-08-02:writtenby_ss"), incremented with HINCRBY every time a
 * reply is actually posted to a story-teller's post.
 *
 * Only story-teller handles (members of echo:story_teller_handles) are
 * tracked here — regular replies to non-story-teller accounts are not
 * counted, since this log exists to answer "how many of each story
 * teller's posts did we reply to today?"
 */
const REDIS_KEY = "echo:story_teller_replies_per_day";

// Exported so callers can bucket days identically.
export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10); // e.g. "2026-08-02"
}

function fieldKey(day: string, handle: string): string {
  return `${day}:${handle}`;
}

/**
 * Record one reply posted to a story-teller's post for today.
 * `handle` should be normalized (no leading @, lowercase) — callers
 * should use the same normalization as storage/storyTellerHandles.ts.
 */
export async function recordStoryTellerReplyForDay(handle: string): Promise<void> {
  const normalized = handle.replace(/^@/, "").toLowerCase();
  if (!normalized) return;
  await getRedisClient().hincrby(REDIS_KEY, fieldKey(dayKey(), normalized), 1);
}

/**
 * How many of this story-teller's posts got a reply today.
 * `handle` should be normalized (no leading @, lowercase).
 */
export async function getStoryTellerReplyCountForDay(handle: string): Promise<number> {
  const normalized = handle.replace(/^@/, "").toLowerCase();
  if (!normalized) return 0;
  const count = await getRedisClient().hget(REDIS_KEY, fieldKey(dayKey(), normalized));
  return count ? parseInt(count, 10) || 0 : 0;
}

/**
 * Full per-handle reply counts for today, oldest-first by handle.
 * Returns entries like { handle: "writtenby_ss", count: 3 }.
 */
export async function getStoryTellerReplyCountsForDay(): Promise<Array<{ handle: string; count: number }>> {
  const today = dayKey();
  const all = await getRedisClient().hgetall(REDIS_KEY);
  return Object.entries(all)
    .filter(([field]) => field.startsWith(`${today}:`))
    .map(([field, count]) => ({
      handle: field.slice(today.length + 1),
      count: parseInt(count, 10) || 0,
    }))
    .sort((a, b) => a.handle.localeCompare(b.handle));
}