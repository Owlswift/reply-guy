import { Relationship } from "../relationship/types";
import { TweetCategory } from "../types/analysis";
import { TimelineTweet } from "../types/tweet";
import {
  pushWithScore,
  popHighest,
  peekHighest,
  reRank,
  removeById,
  updateItemStatus,
  size as prioritySize,
  getScoredItems,
  clear as priorityClear
} from "./priorityQueue";

export interface QueueItem {
  id: string;
  url: string;
  author: string;
  text: string;
  relationship?: Relationship;
  tweetType?: TweetCategory;
  priority?: number;
  draft?: string | undefined;
  attempts?: number;
  createdAt: number;
  status: "pending" | "drafting" | "ready" | "processing" | "posted" | "failed";
}

/**
 * Enqueue a tweet into the priority queue.
 * The tweet's original data is needed for continuous re-scoring.
 */
export function enqueue(item: QueueItem, tweet?: TimelineTweet): void {
  if (tweet) {
    pushWithScore(item, tweet);
  } else {
    // Fallback: push without scoring data (will get a default score)
    // This shouldn't happen in normal flow — always pass the tweet
    pushWithScore(item, {
      id: item.id,
      author: item.author,
      username: "",
      text: item.text,
      url: item.url,
      verified: false,
      following: false,
      followsYou: false,
      likes: 0,
      replies: 0,
      reposts: 0,
      source: "timeline",
      createdAt: new Date(item.createdAt)
    });
  }
}

/**
 * Dequeue the highest-scoring item.
 */
export function dequeue(): QueueItem | undefined {
  return popHighest();
}

/**
 * Peek at the highest-scoring item without removing it.
 */
export function peek(): QueueItem | undefined {
  return peekHighest();
}

/**
 * Get the current queue size.
 */
export function queueSize(): number {
  return prioritySize();
}

/**
 * Get all items in the queue (for display/debugging).
 */
export function getQueue(): QueueItem[] {
  return getScoredItems().map(s => ({
    id: s.id,
    url: "",
    author: s.author,
    text: s.text,
    createdAt: Date.now(),
    status: "pending" as const
  }));
}

/**
 * Find a pending item (for backward compatibility).
 * Returns the highest-scored pending item.
 */
export function findPending(): QueueItem | undefined {
  return peekHighest();
}

/**
 * Find a drafting item (for backward compatibility).
 * Not used in priority mode — returns undefined.
 */
export function findDrafting(): QueueItem | undefined {
  return undefined;
}

/**
 * Update an item's properties by ID.
 */
export function updateItem(id: string, updates: Partial<QueueItem>): void {
  updateItemStatus(id, updates);
}

/**
 * Re-rank the queue (call periodically as tweets age).
 */
export function reRankQueue(): void {
  reRank();
}

/**
 * Clear the queue.
 */
export function clearQueue(): void {
  priorityClear();
}