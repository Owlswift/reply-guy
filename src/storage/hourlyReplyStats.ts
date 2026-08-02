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

// Exported so storage/hourlyReplyQuota.ts buckets hours identically —
// two independent hour-bucketing schemes could drift apart at the
// boundary otherwise.
export function hourKey(date: Date = new Date()): string {
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

/**
 * Sum of every hour-bucket for today (server-local calendar day, same
 * "YYYY-MM-DD" prefix as hourKey()'s ISO string) — the dispatcher's daily
 * cap check. Reuses the existing per-hour hash rather than a second
 * counter, so there's only ever one source of truth for reply volume.
 */
export async function getTodayReplyCount(): Promise<number> {
  const todayPrefix = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const all = await getReplyCountsPerHour();
  return all
    .filter((h) => h.hour.startsWith(todayPrefix))
    .reduce((sum, h) => sum + h.count, 0);
}
