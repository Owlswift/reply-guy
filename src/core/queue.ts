import { Relationship } from "../relationship/types";
import { TweetType } from "../ai/classifyTweet";

export interface QueueItem {
  id: string;
  url: string;
  author: string;
  text: string;
  relationship?: Relationship;
  tweetType?: TweetType;
  priority?: number;
  draft?: string | undefined;
  attempts?: number;
  createdAt: number;
  status: "pending" | "drafting" | "ready" | "processing" | "posted" | "failed";
}

const queue: QueueItem[] = [];

export function enqueue(item: QueueItem): void {
  queue.push(item);
}

export function dequeue(): QueueItem | undefined {
  return queue.shift();
}

export function peek(): QueueItem | undefined {
  return queue[0];
}

export function queueSize(): number {
  return queue.length;
}

export function getQueue(): QueueItem[] {
  return queue;
}

export function findPending(): QueueItem | undefined {
  return queue.find(t => t.status === "pending");
}

export function findDrafting(): QueueItem | undefined {
  return queue.find(t => t.status === "drafting");
}

export function updateItem(id: string, updates: Partial<QueueItem>): void {
  const item = queue.find(t => t.id === id);
  if (item) {
    Object.assign(item, updates);
  }
}