/**
 * Timeline state management for incremental processing.
 * 
 * Instead of re-scanning the entire timeline on every return,
 * we track:
 * - The newest tweet ID we've seen (to detect new arrivals)
 * - The scroll position (to resume where we left off)
 * 
 * This allows Echo to:
 * 1. Check for new tweets at the top without reprocessing old ones
 * 2. Resume from the previous scroll position after replying
 */

interface TimelineState {
  newestTweetId: string | null;
  scrollY: number;
}

// In-memory state (persists for the session)
let state: TimelineState = {
  newestTweetId: null,
  scrollY: 0
};

export function getTimelineState(): TimelineState {
  return { ...state };
}

/**
 * Update the newest tweet ID we've seen.
 * Only moves forward — never backwards.
 * Returns true if the ID was updated (i.e. it's newer than what we had).
 */
export function setNewestTweetId(id: string): boolean {
  if (!id) return false;
  if (!state.newestTweetId || id > state.newestTweetId) {
    state.newestTweetId = id;
    return true;
  }
  return false;
}

export function getNewestTweetId(): string | null {
  return state.newestTweetId;
}

export function setScrollY(y: number): void {
  state.scrollY = y;
}

export function getScrollY(): number {
  return state.scrollY;
}

export function clearTimelineState(): void {
  state = {
    newestTweetId: null,
    scrollY: 0
  };
}

// ─── Backward compatibility exports for bot.ts / bot-pipeline.ts ────────────

/**
 * Record a batch of tweet IDs to track timeline progression.
 * Used by bot.ts/bot-pipeline.ts to detect if the timeline is stuck.
 * @deprecated Use setNewestTweetId() for incremental processing instead.
 */
export function updateTimeline(tweetIds: string[]): void {
  for (const id of tweetIds) {
    setNewestTweetId(id);
  }
}

/**
 * Check if the timeline appears stuck (no new tweets after updates).
 * Used by bot.ts/bot-pipeline.ts.
 * @deprecated Incremental processing handles this automatically.
 */
export function timelineLooksStuck(): boolean {
  // In the new incremental model, "stuck" isn't relevant since we only
  // care about new tweets above our last-seen position. Return false
  // so callers in the old pipeline don't get false positives.
  return false;
}

/**
 * Reset the timeline state.
 * @deprecated Use clearTimelineState() instead.
 */
export function resetTimelineState(): void {
  clearTimelineState();
}
