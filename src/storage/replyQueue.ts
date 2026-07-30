import { randomUUID } from "crypto";
import { getRedisClient } from "./redis";
import { Relationship } from "../relationship/types";

/**
 * The shared reply queue every automated-posting producer pushes onto
 * (main-interactive.ts, engage/processReply.ts, catchup/runCatchup.ts)
 * instead of posting directly — src/dispatcher.ts is the only thing that
 * ever reads from it and actually posts. See the "myself" manual path in
 * each producer, which is NOT queued here — a human choosing to type and
 * send right now isn't the "looks automated" problem this exists to solve.
 *
 * Five Redis LISTS, one per priority tier (same LIST-based pattern as
 * storage/flaggedPosts.ts) — dequeueNextReplyJob() checks tier 1 first,
 * then 2, up through 4, so a burst of low-priority catchup jobs never
 * delays a higher-priority conversation reply behind it.
 */
export type ReplySource = "interactive" | "conversation" | "catchup_priority" | "catchup_stories";

export interface MemoryPayload {
  tweetId: string;
  tweetText: string;
  authorHandle: string;
  relationship: Relationship;
  aiDraft: string;
  finalReply: string;
}

// Covers the distinct post-success bookkeeping patterns that exist today
// across the 3 producers — the dispatcher runs the matching one after a
// successful post, so tracking (addReplyNode/markReplied/memory-save) only
// ever records a reply that actually, successfully posted.
export type OnPostedHandler =
  | { type: "main_interactive"; itemId: string; url: string; reason: string; memory?: MemoryPayload }
  | { type: "conversation"; rootTweetId: string; parentReplyId: string; echoHandle: string; text: string; depth: number }
  | { type: "catchup"; tweetId: string; reason: string; memory?: MemoryPayload };

export interface ReplyJob {
  id: string;
  source: ReplySource;
  priority: 1 | 2 | 3 | 4;
  tweetUrl: string;
  tweetId: string;
  authorHandle: string;
  replyText: string;
  createdAt: number;
  retryCount: number;
  onPosted: OnPostedHandler;
}

const MAX_RETRIES = 2;

function keyForPriority(priority: 1 | 2 | 3 | 4): string {
  return `echo:reply_queue:${priority}`;
}

const PRIORITY_TIERS: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

export async function enqueueReplyJob(
  job: Omit<ReplyJob, "id" | "createdAt" | "retryCount">
): Promise<void> {
  const fullJob: ReplyJob = {
    ...job,
    id: randomUUID(),
    createdAt: Date.now(),
    retryCount: 0,
  };
  await getRedisClient().rpush(keyForPriority(fullJob.priority), JSON.stringify(fullJob));
}

/**
 * Pop the oldest job from the highest-priority non-empty tier (1 is
 * highest). Returns null if every tier is empty.
 */
export async function dequeueNextReplyJob(): Promise<ReplyJob | null> {
  const client = getRedisClient();
  for (const priority of PRIORITY_TIERS) {
    const raw = await client.lpop(keyForPriority(priority));
    if (raw) return JSON.parse(raw) as ReplyJob;
  }
  return null;
}

/**
 * Put a job back on its own priority tier after a failed post attempt,
 * incrementing retryCount. Returns false (instead of requeueing) once
 * MAX_RETRIES is exceeded, so the caller knows to give up and log it as a
 * permanent failure instead of retrying forever.
 */
export async function requeueReplyJob(job: ReplyJob): Promise<boolean> {
  if (job.retryCount >= MAX_RETRIES) return false;
  const retried: ReplyJob = { ...job, retryCount: job.retryCount + 1 };
  await getRedisClient().rpush(keyForPriority(retried.priority), JSON.stringify(retried));
  return true;
}

/** Total jobs waiting across all priority tiers — for status/monitoring. */
export async function getQueueSize(): Promise<number> {
  const client = getRedisClient();
  const counts = await Promise.all(PRIORITY_TIERS.map((p) => client.llen(keyForPriority(p))));
  return counts.reduce((sum, n) => sum + n, 0);
}
