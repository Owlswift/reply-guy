import { getRedisClient } from "./redis";
import { hourKey } from "./hourlyReplyStats";
import { log } from "../utils/logger";

/**
 * A hard reply budget for the current hour, spread across it — the
 * mechanism behind the "1-3 replies/hour, randomized, spaced
 * unpredictably, no fixed cadence" policy. Shared across the scripts that
 * actually opt into it (main-interactive.ts, catchup:priority,
 * catchup:stories) — deliberately NOT notifications.ts/engage.ts (reply to
 * comments on your own posts, stay unpaced/ungated per explicit
 * instruction) and NOT catchup:forex-crypto (same opt-out, added later).
 *
 * Uses its OWN counter (echo:quota_replies_per_hour), separate from
 * hourlyReplyStats.ts's general echo:replies_per_hour hash — that one
 * still records every reply from every script (it backs the purely
 * informational `pnpm reply-stats`), but reusing it here would mean an
 * excluded script's reply silently eats into this quota's budget even
 * though it never waits for it — confirmed live: the "remaining" count in
 * a catchup:stories run dropped faster than catchup:stories itself was
 * posting. recordQuotaReply() (below) is only ever called from the
 * quota-gated scripts' own success paths, not from reply/reply.ts's
 * clickReply() — unlike recordReplyForHour(), it isn't universal.
 */

const MIN_PER_HOUR = 3;
const MAX_PER_HOUR = 6;
const TARGET_KEY_PREFIX = "echo:hourly_reply_target:";
const QUOTA_COUNT_KEY = "echo:quota_replies_per_hour";
const LAST_REPLY_AT_KEY = "echo:quota_last_reply_at";

// A little over an hour — the key naturally becomes irrelevant once the
// hour it names has passed, this just keeps Redis from accumulating one
// stale key per hour forever.
const TARGET_KEY_TTL_SECONDS = 3700;

function rollTarget(): number {
  return MIN_PER_HOUR + Math.floor(Math.random() * (MAX_PER_HOUR - MIN_PER_HOUR + 1));
}

/**
 * The random reply target for the current hour — rolled once and shared
 * by every process via Redis (SET ... NX), so two scripts starting up in
 * the same hour never disagree on the budget. Fails open to a fresh local
 * roll if Redis is unreachable (better an ungoverned hour than a stalled
 * bot).
 */
export async function getOrSetHourlyTarget(): Promise<number> {
  const redis = getRedisClient();
  const key = `${TARGET_KEY_PREFIX}${hourKey()}`;

  try {
    const existing = await redis.get(key);
    if (existing) {
      const parsed = parseInt(existing, 10);
      if (Number.isFinite(parsed)) return parsed;
    }

    const target = rollTarget();
    await redis.set(key, target.toString(), "EX", TARGET_KEY_TTL_SECONDS, "NX");
    // Read back rather than trust our own roll — if another process won
    // the NX race between our GET and SET above, this returns THEIR value
    // so every process agrees on the same target for this hour.
    const final = await redis.get(key);
    return final ? parseInt(final, 10) || target : target;
  } catch (err) {
    log(`[HourlyQuota] Redis unreachable, rolling a local-only target: ${err}`);
    return rollTarget();
  }
}

/**
 * Called explicitly from each quota-gated script's own success path
 * (main-interactive.ts's PHASE 4a/4b and manual-reply bookkeeping,
 * catchup/runCatchup.ts's myself/ChatGPT success branches) right after a
 * reply actually posts — NOT from reply/reply.ts's clickReply(), which
 * would make it universal again. Bumps this hour's quota count AND the
 * "last quota reply at" timestamp the pacing gate needs, in one call.
 */
export async function recordQuotaReply(): Promise<void> {
  const redis = getRedisClient();
  await Promise.all([
    redis.hincrby(QUOTA_COUNT_KEY, hourKey(), 1).catch(() => {}),
    redis.set(LAST_REPLY_AT_KEY, Date.now().toString()).catch(() => {}),
  ]);
}

async function getQuotaReplyCount(): Promise<number> {
  const count = await getRedisClient().hget(QUOTA_COUNT_KEY, hourKey());
  return count ? parseInt(count, 10) || 0 : 0;
}

/**
 * Full history of the QUOTA-specific counter, oldest first — unlike
 * hourlyReplyStats.ts's getReplyCountsPerHour() (every script, unpaced
 * scripts included), this only reflects main-interactive.ts/
 * catchup:priority/catchup:stories, i.e. the scripts that actually wait on
 * waitForReplyTurn(). This is the number that should actually stay within
 * MIN_PER_HOUR-MAX_PER_HOUR each hour.
 */
export async function getQuotaReplyCountsPerHour(): Promise<Array<{ hour: string; count: number }>> {
  const all = await getRedisClient().hgetall(QUOTA_COUNT_KEY);
  return Object.entries(all)
    .map(([hour, count]) => ({ hour, count: parseInt(count, 10) || 0 }))
    .sort((a, b) => a.hour.localeCompare(b.hour));
}

async function msSinceLastReply(): Promise<number | null> {
  const raw = await getRedisClient().get(LAST_REPLY_AT_KEY).catch(() => null);
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? Date.now() - parsed : null;
}

function msUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  return next.getTime() - now.getTime();
}

// How much the enforced gap varies from the "even spacing" baseline —
// 0.3x-1.5x — so consecutive gaps don't all land on the same average
// value, which would itself read as a schedule.
const JITTER_MIN = 0.3;
const JITTER_MAX = 1.5;

/**
 * Blocks — pausing the whole calling script, not just its posting — until
 * it's actually this reply's turn: both under this hour's random target
 * AND enough time has passed since the last reply (anywhere) to keep the
 * remaining budget spread across the rest of the hour rather than
 * clustered. Re-checks from scratch after every wait, since another
 * process posting in the meantime changes both the count and the pacing
 * math. `label` prefixes log lines the same way every other script's own
 * label does (e.g. "[Catchup:Stories]").
 */
export async function waitForReplyTurn(label: string): Promise<void> {
  while (true) {
    let target: number;
    let count: number;
    try {
      [target, count] = await Promise.all([getOrSetHourlyTarget(), getQuotaReplyCount()]);
    } catch (err) {
      log(`${label} Redis unreachable, proceeding without hourly pacing: ${err}`);
      return;
    }

    if (count >= target) {
      const waitMs = msUntilNextHour() + 2000;
      log(`${label} Hourly reply quota reached (${count}/${target}) — pausing for ${Math.ceil(waitMs / 60000)}m until the next hour.`);
      await new Promise((r) => setTimeout(r, waitMs));
      log(`${label} New hour, new quota — resuming.`);
      continue; // re-check fresh — another process may have already started the new hour's count
    }

    const remaining = target - count;
    const timeLeftMs = Math.max(msUntilNextHour(), 60_000);
    const avgGapMs = timeLeftMs / remaining;
    const jitter = JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN);
    const minGapMs = avgGapMs * jitter;

    const sinceLast = await msSinceLastReply();
    if (sinceLast !== null && sinceLast < minGapMs) {
      const waitMs = minGapMs - sinceLast;
      log(`${label} Pacing — spreading ${remaining} remaining repl${remaining === 1 ? "y" : "ies"} across ~${Math.round(timeLeftMs / 60000)}m left this hour, waiting ${Math.ceil(waitMs / 60000)}m before the next one.`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue; // recompute — count/timing may have moved while waiting
    }

    // Reached whenever no wait is actually needed (enough time already
    // passed since the last reply anywhere) — previously this returned
    // silently, so a run could go through several posts with zero visible
    // indication of the hour's target/count/remaining at all.
    log(`${label} Hourly quota: ${count}/${target} posted this hour, ${remaining} remaining — proceeding.`);
    return;
  }
}
