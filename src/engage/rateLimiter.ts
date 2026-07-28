/**
 * Human-like rate limiter for the engage command.
 *
 * Instead of replying to 100 comments instantly, we wait a random
 * interval between each reply to look more human.
 *
 * Wait times: 45s-1min15s between replies, regardless of how many
 * have already gone out this session.
 */

export interface RateLimitConfig {
  /** Initial minimum wait between replies (ms) */
  initialMinWaitMs: number;
  /** Initial maximum wait between replies (ms) */
  initialMaxWaitMs: number;
  /** Later minimum wait between replies (ms) */
  laterMinWaitMs: number;
  /** Later maximum wait between replies (ms) */
  laterMaxWaitMs: number;
  /** After how many replies to switch to "later" pacing */
  laterThreshold: number;
  /** Maximum replies in one engage session */
  maxReplies: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  initialMinWaitMs: 45 * 1000,       // 45 seconds
  initialMaxWaitMs: 75 * 1000,       // 1 minute 15 seconds
  laterMinWaitMs: 45 * 1000,         // 45 seconds
  laterMaxWaitMs: 75 * 1000,         // 1 minute 15 seconds
  laterThreshold: 5,
  maxReplies: 20,
};

let config: RateLimitConfig = { ...DEFAULT_CONFIG };

/**
 * Set a custom rate limit config.
 */
export function setRateLimitConfig(custom: Partial<RateLimitConfig>): void {
  config = { ...config, ...custom };
}

/**
 * Get the current rate limit config.
 */
export function getRateLimitConfig(): RateLimitConfig {
  return { ...config };
}

/**
 * Calculate the wait time before the next reply, based on how many
 * replies have already been posted in this session.
 */
export function getNextWaitTime(replyCount: number): number {
  const useLaterPacing = replyCount >= config.laterThreshold;

  const minMs = useLaterPacing ? config.laterMinWaitMs : config.initialMinWaitMs;
  const maxMs = useLaterPacing ? config.laterMaxWaitMs : config.initialMaxWaitMs;

  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Check if we've hit the maximum replies for this session.
 */
export function hasReachedMaxReplies(replyCount: number): boolean {
  return replyCount >= config.maxReplies;
}

/**
 * Format a wait time in milliseconds to a human-readable string.
 */
export function formatWaitTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}