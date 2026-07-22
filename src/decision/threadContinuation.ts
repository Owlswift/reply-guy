import { TimelineTweet } from "../types/tweet";

function normalizeHandle(value: string): string {
  return value.replace(/^@/, "").toLowerCase();
}

/**
 * Detect a self-reply thread continuation. X surfaces each part of a
 * multi-tweet thread as its own top-level article in notifications/timeline
 * feeds — each with its own unique tweet id — even though it's really a
 * continuation of an earlier story, not a fresh one. If the tweet is a
 * reply and the author is replying to themselves, treat it as one.
 */
export function isSelfReplyContinuation(tweet: TimelineTweet): boolean {
  if (!tweet.isReply || !tweet.replyingToHandle) return false;
  return normalizeHandle(tweet.replyingToHandle) === normalizeHandle(tweet.username);
}
