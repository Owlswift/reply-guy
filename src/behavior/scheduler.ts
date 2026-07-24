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

// ─── Speed multiplier ─────────────────────────────────────────────────────────
// A single global dial on every delay below, expressed as an actual SPEED
// (how fast Echo goes), not a delay factor: 1 = the default timings, 2 =
// twice as fast (delays halved, less human-like cover), 0.5 = half as fast
// (delays doubled, more cover). Internally this means the multiplier applied
// to each delay is 1/speed — speed and delay are inversely related, same as
// "2x speed" means half the time in a video player. Set once at startup from
// the --speed CLI flag (see main-interactive.ts's argv parsing) rather than
// an env var, so it can be changed per-run without touching config.
// Deliberately NOT applied to maybeInterruption()'s 10% chance or
// shouldSkipTweet()/getReplyRatio() — those are behavioral odds, not
// timings, and scaling them wasn't part of what was asked for here.

let speedValue = 1;

export function setSpeedMultiplier(speed: number): void {
  if (!Number.isFinite(speed) || speed <= 0) {
    console.warn(`[scheduler] Ignoring invalid --speed value (${speed}) — keeping ${speedValue}x.`);
    return;
  }
  speedValue = speed;
}

export function getSpeedMultiplier(): number {
  return speedValue;
}

// The actual factor delays get multiplied by — the reciprocal of speed.
function delayFactor(): number {
  return 1 / speedValue;
}

// ─── Action timing ───────────────────────────────────────────────────────────

/**
 * Reading time before replying — scaled by tweet length.
 * Returns milliseconds.
 */
export function getReadingTime(text: string): number {
  const len = text?.length ?? 0;

  // Base reading time: 8–20 seconds based on tweet length (trimmed from a
  // 15-40s range — that alone was adding up to 40s of idle wait per tweet,
  // and combined with the other pacing delays below was a large chunk of
  // why replies were taking 2-4 minutes end to end).
  const baseMin = 8_000;
  const baseMax = 20_000;
  const ratio = Math.min(1, len / 1200);
  const baseTime = baseMin + (baseMax - baseMin) * ratio;

  // ±30% jitter
  const jitter = 0.7 + Math.random() * 0.6;

  return Math.round(baseTime * jitter * delayFactor());
}

/**
 * Small filler action like scrolling, skipping, or pausing mid-session.
 * Returns milliseconds.
 */
export function getMicroBreak(): number {
  // 1–4 seconds (trimmed from 2-8s)
  return Math.round((1_000 + Math.random() * 3_000) * delayFactor());
}

/**
 * Delay between finishing reading and starting to reply.
 * Simulates "deciding what to say."
 * Returns milliseconds.
 */
export function getThinkingTime(): number {
  // 0.5–2 seconds (trimmed from 1-4s)
  return Math.round((500 + Math.random() * 1_500) * delayFactor());
}

/**
 * Pause after posting a reply before the next action.
 * Returns milliseconds.
 */
export function getPostReplyPause(): number {
  // 2–5 seconds (trimmed from 3-8s)
  return Math.round((2_000 + Math.random() * 3_000) * delayFactor());
}

/**
 * Occasional random interruption — checking notifications, getting distracted.
 * ~10% chance (not scaled by speed — only the duration is).
 * Returns 0 if no interruption.
 */
export function maybeInterruption(): number {
  const chance = 0.10;
  if (Math.random() > chance) return 0;

  // Duration: 10–30 seconds (trimmed from 15-60s)
  return Math.round((10_000 + Math.random() * 20_000) * delayFactor());
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