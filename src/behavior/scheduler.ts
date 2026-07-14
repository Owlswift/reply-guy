/**
 * Timing utilities — human-like delays for Echo's actions.
 *
 * These create natural pauses between actions so Echo doesn't appear
 * bot-like. All timings include random jitter and can optionally
 * scale with session fatigue (which is now always 0).
 */

// ─── Runtime state (simplified — always active) ──────────────────────────────

let sessionFatigue = 0; // Always 0 — kept for API compatibility

export function getSessionFatigue(): number {
  return sessionFatigue;
}

// ─── Action timing ───────────────────────────────────────────────────────────

/**
 * Reading time before replying — scaled by tweet length.
 * Returns milliseconds.
 */
export function getReadingTime(text: string): number {
  const len = text?.length ?? 0;

  // Base reading time: 15–40 seconds based on tweet length
  const baseMin = 15_000;
  const baseMax = 40_000;
  const ratio = Math.min(1, len / 1200);
  const baseTime = baseMin + (baseMax - baseMin) * ratio;

  // ±30% jitter
  const jitter = 0.7 + Math.random() * 0.6;

  return Math.round(baseTime * jitter);
}

/**
 * Small filler action like scrolling, skipping, or pausing mid-session.
 * Returns milliseconds.
 */
export function getMicroBreak(): number {
  // 2–8 seconds
  return Math.round(2_000 + Math.random() * 6_000);
}

/**
 * Delay between finishing reading and starting to reply.
 * Simulates "deciding what to say."
 * Returns milliseconds.
 */
export function getThinkingTime(): number {
  // 1–4 seconds
  return Math.round(1_000 + Math.random() * 3_000);
}

/**
 * Pause after posting a reply before the next action.
 * Returns milliseconds.
 */
export function getPostReplyPause(): number {
  // 3–8 seconds
  return Math.round(3_000 + Math.random() * 5_000);
}

/**
 * Occasional random interruption — checking notifications, getting distracted.
 * ~10% chance.
 * Returns 0 if no interruption.
 */
export function maybeInterruption(): number {
  const chance = 0.10;
  if (Math.random() > chance) return 0;

  // Duration: 15–60 seconds
  return Math.round(15_000 + Math.random() * 45_000);
}

/**
 * Decide whether to occasionally skip reading a tweet and just scroll past.
 * ~20% chance.
 */
export function shouldSkipTweet(): boolean {
  return Math.random() < 0.2;
}

/**
 * "Mood" modifier — affects how many tweets are actually replied to vs just read.
 * Returns 0.0 (read nothing) to 1.0 (reply to everything).
 * With session scheduling removed, defaults to a healthy 60–80% ratio.
 */
export function getReplyRatio(): number {
  return 0.6 + Math.random() * 0.2;
}