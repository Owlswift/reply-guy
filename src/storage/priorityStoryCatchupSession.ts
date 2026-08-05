import { getRedisClient } from "./redis";

/**
 * A resumable, shuffled work queue for a single catchupPriorityStoryTellers.ts
 * run — same shape as storyCatchupSession.ts, but its own Redis key so the
 * two scripts' sessions never collide if run around the same time. No mode
 * tracking here (unlike storyCatchupSession.ts's normal/priority_only
 * alternation) — this script's candidate list is always
 * PRIORITY_STORY_TELLER_HANDLES, every run.
 */
const SESSION_KEY = "echo:priority_story_catchup_session";

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = temp;
  }
  return copy;
}

/**
 * Returns the handles left to process this session — resuming a previous,
 * interrupted session's leftovers if any exist, or a fresh random shuffle
 * of `allHandles` (persisted to Redis) otherwise.
 */
export async function getOrStartSession(allHandles: string[]): Promise<string[]> {
  const client = getRedisClient();
  const existing = await client.lrange(SESSION_KEY, 0, -1);
  if (existing.length > 0) return existing;

  const shuffled = shuffle(allHandles);
  if (shuffled.length > 0) {
    await client.rpush(SESSION_KEY, ...shuffled);
  }
  return shuffled;
}

/** Mark one handle done — removes it from the session's remaining list. */
export async function markSessionHandleDone(handle: string): Promise<void> {
  await getRedisClient().lrem(SESSION_KEY, 1, handle);
}

/**
 * Clear the session entirely — called once a run finishes all its handles,
 * so the next invocation starts fresh with a newly randomized order rather
 * than finding a stale (by then empty, but still worth being explicit)
 * leftover list.
 */
export async function clearSession(): Promise<void> {
  await getRedisClient().del(SESSION_KEY);
}
