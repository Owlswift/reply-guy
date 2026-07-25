import { getRedisClient } from "./redis";

/**
 * Reply counts bucketed by calendar hour, persisted in Redis so the count
 * survives process restarts — unlike stats/runtime.ts's `stats.posted`,
 * which is in-memory only and resets every time Echo restarts (which
 * happens often: the watchdog, ensure-running.sh, manual stops).
 *
 * A single Redis hash (echo:replies_per_hour), one field per hour
 * (e.g. "2026-07-24T10"), incremented with HINCRBY every time a reply is
 * actually posted.
 */
const REDIS_KEY = "echo:replies_per_hour";

function hourKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13); // e.g. "2026-07-24T10"
}

export async function recordReplyForHour(): Promise<void> {
  await getRedisClient().hincrby(REDIS_KEY, hourKey(), 1);
}

export async function getCurrentHourReplyCount(): Promise<number> {
  const count = await getRedisClient().hget(REDIS_KEY, hourKey());
  return count ? parseInt(count, 10) || 0 : 0;
}

/**
 * Full history, oldest first. Callers can slice the tail for "last N hours."
 */
export async function getReplyCountsPerHour(): Promise<Array<{ hour: string; count: number }>> {
  const all = await getRedisClient().hgetall(REDIS_KEY);
  return Object.entries(all)
    .map(([hour, count]) => ({ hour, count: parseInt(count, 10) || 0 }))
    .sort((a, b) => a.hour.localeCompare(b.hour));
}
