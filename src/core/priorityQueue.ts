import { QueueItem } from "./queue";
import { TimelineTweet } from "../types/tweet";
import { scoreTweet, shouldSkipDueToAgeAndReplies } from "../decision/scoreTweet";

/**
 * Priority queue that continuously re-ranks tweets as they age.
 *
 * Instead of a FIFO queue, we maintain a max-heap ordered by a
 * visibility score that combines age + reply count + author + relationship.
 *
 * Every time new tweets arrive, the queue is re-ranked because
 * time is constantly reducing every tweet's value.
 */

// Internal item that stores the original tweet data for re-scoring
interface ScoredItem {
  queueItem: QueueItem;
  tweet: TimelineTweet;
  lastScore: number;
  lastScoredAt: number;
}

let items: ScoredItem[] = [];

// ──────────────────────────────────────────────────
// Scoring with caching (re-score if > 30s old)
// ──────────────────────────────────────────────────
const RE_SCORE_INTERVAL_MS = 30_000;

function getScore(item: ScoredItem): number {
  const now = Date.now();
  if (now - item.lastScoredAt > RE_SCORE_INTERVAL_MS) {
    item.lastScore = scoreTweet(item.tweet);
    item.lastScoredAt = now;
  }
  return item.lastScore;
}

// ──────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────

export function pushWithScore(queueItem: QueueItem, tweet: TimelineTweet): void {
  const score = scoreTweet(tweet);
  items.push({
    queueItem,
    tweet,
    lastScore: score,
    lastScoredAt: Date.now()
  });
  // Re-sort descending by score
  items.sort((a, b) => getScore(b) - getScore(a));
}

/**
 * Pop the highest-scoring item.
 * Also prunes any items that have become too old + too saturated.
 */
export function popHighest(): QueueItem | undefined {
  // Prune expired items first
  items = items.filter(item => !shouldSkipDueToAgeAndReplies(item.tweet));

  if (items.length === 0) return undefined;

  // Re-sort to ensure we have the latest scores
  items.sort((a, b) => getScore(b) - getScore(a));

  const best = items.shift();
  return best?.queueItem;
}

/**
 * Peek at the highest-scoring item without removing it.
 */
export function peekHighest(): QueueItem | undefined {
  if (items.length === 0) return undefined;

  // Re-sort to ensure latest scores
  items.sort((a, b) => getScore(b) - getScore(a));

  return items[0]?.queueItem;
}

/**
 * Re-rank all items in the queue (called periodically as tweets age).
 */
export function reRank(): void {
  items.sort((a, b) => getScore(b) - getScore(a));
}

/**
 * Update a queue item's properties by ID.
 */
export function updateItemStatus(id: string, updates: Partial<QueueItem>): void {
  const found = items.find(item => item.queueItem.id === id);
  if (found) {
    Object.assign(found.queueItem, updates);
  }
}

/**
 * Remove an item by ID.
 */
export function removeById(id: string): void {
  items = items.filter(item => item.queueItem.id !== id);
}

/**
 * Get the current queue size.
 */
export function size(): number {
  return items.length;
}

/**
 * Get all items with their current scores (for display).
 */
export function getScoredItems(): { id: string; score: number; author: string; text: string }[] {
  return items.map(item => ({
    id: item.queueItem.id,
    score: getScore(item),
    author: item.queueItem.author,
    text: item.queueItem.text.slice(0, 80)
  }));
}

/**
 * Clear the queue.
 */
export function clear(): void {
  items = [];
}