import { getRedisClient } from "./redis";

/**
 * A resumable, shuffled work queue for a single catchupForexCrypto.ts run.
 * Distinct from forexCryptoHandles.ts's permanent SET (the full list of
 * every author ever discovered) — this is scoped to ONE session's remaining
 * work: reading getForexCryptoHandles() fresh and processing it in the same
 * order every time would mean an interrupted run always restarts from the
 * front of a potentially long list, never reaching handles further down.
 *
 * A Redis LIST (order matters and needs to survive a restart), one field
 * per handle still left to process this session. Consumed via
 * markSessionHandleDone() as each one finishes; getOrStartSession() picks
 * up whatever's left if the list is non-empty (a previous run was
 * interrupted), or shuffles the full handle set fresh otherwise.
 */
const SESSION_KEY = "echo:forex_crypto_catchup_session";

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