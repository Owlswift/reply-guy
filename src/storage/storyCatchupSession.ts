import { getRedisClient } from "./redis";

/**
 * A resumable, shuffled work queue for a single catchupStoryTellers.ts run.
 * Distinct from storyTellerHandles.ts's permanent SET (the full list of
 * every author ever discovered) — this is scoped to ONE session's remaining
 * work: reading getStoryTellerHandles() fresh and processing it in the same
 * order every time would mean an interrupted run always restarts from the
 * front of a potentially long list, never reaching handles further down.
 *
 * A Redis LIST (order matters and needs to survive a restart), one field
 * per handle still left to process this session. Consumed via
 * markSessionHandleDone() as each one finishes; getOrStartSession() picks
 * up whatever's left if the list is non-empty (a previous run was
 * interrupted), or shuffles a fresh candidate set otherwise.
 */
const SESSION_KEY = "echo:story_catchup_session";
const SESSION_MODE_KEY = "echo:story_catchup_session_mode";
const LAST_MODE_KEY = "echo:story_catchup_last_mode";

export type CatchupStoriesMode = "normal" | "priority_only";

export interface StoryCatchupSession {
  handles: string[];
  mode: CatchupStoriesMode;
  resumed: boolean;
}

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
 * Returns the handles left to process this session, plus which mode it's
 * actually running as.
 *
 * If a previous run was interrupted, this resumes its exact leftover list
 * AND the mode it was started under (read back from SESSION_MODE_KEY, not
 * recomputed) — a resumed session must never be relabeled into whatever
 * mode a fresh decision would produce, since the two can disagree (e.g. an
 * old session left over from before mode-tracking existed).
 *
 * Otherwise starts a fresh session: alternates off the last COMPLETED
 * session's mode (getLastCatchupStoriesMode) — normal is always followed
 * by priority_only and vice versa — falling back to normal if there are no
 * priority handles to run. The chosen mode is persisted alongside the
 * session immediately, so any resume of THIS session later resolves back
 * to the same mode.
 */
export async function getOrStartSession(
  allHandles: string[],
  priorityHandles: string[]
): Promise<StoryCatchupSession> {
  const client = getRedisClient();
  const existing = await client.lrange(SESSION_KEY, 0, -1);
  if (existing.length > 0) {
    const storedMode = await client.get(SESSION_MODE_KEY);
    const mode: CatchupStoriesMode = storedMode === "priority_only" ? "priority_only" : "normal";
    return { handles: existing, mode, resumed: true };
  }

  const lastMode = await getLastCatchupStoriesMode();
  const mode: CatchupStoriesMode =
    lastMode !== "priority_only" && priorityHandles.length > 0 ? "priority_only" : "normal";
  const candidates = mode === "priority_only" ? priorityHandles : allHandles;

  const shuffled = shuffle(candidates);
  if (shuffled.length > 0) {
    await client.rpush(SESSION_KEY, ...shuffled);
  }
  await client.set(SESSION_MODE_KEY, mode);
  return { handles: shuffled, mode, resumed: false };
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
  await getRedisClient().del(SESSION_KEY, SESSION_MODE_KEY);
}

/**
 * Which mode the last COMPLETED session ran as — getOrStartSession()
 * alternates off this when starting a brand new session. Only updated on
 * completion (alongside clearSession()) — an interrupted run never reaches
 * that point, which is fine, since its own mode is preserved separately
 * via SESSION_MODE_KEY for the resume path above.
 */
export async function getLastCatchupStoriesMode(): Promise<CatchupStoriesMode | null> {
  const value = await getRedisClient().get(LAST_MODE_KEY);
  return value === "normal" || value === "priority_only" ? value : null;
}

export async function setLastCatchupStoriesMode(mode: CatchupStoriesMode): Promise<void> {
  await getRedisClient().set(LAST_MODE_KEY, mode);
}
