import { getRedisClient } from "./redis";

/**
 * Tracks the last time we replied to each author, independent of any
 * per-tweet dedup (repliedTweets.ts/seenNotifications.ts) or the
 * self-reply-thread detector (decision/threadContinuation.ts).
 *
 * threadContinuation.ts's isSelfReplyContinuation() only catches a thread
 * segment if X's DOM shows a "Replying to @self" banner on that specific
 * notification/timeline card — and X doesn't reliably render that for
 * every part of a multi-tweet thread. When it doesn't, each segment looks
 * like a brand-new, unrelated post, and Echo replies to every single one —
 * exactly the "why is this bot replying to every paragraph of the same
 * story" behavior that's one of the most obvious tells that it's a bot.
 *
 * This is a second, DOM-independent gate: if we replied to this author
 * within the window below, skip — regardless of whether X labeled the new
 * post as a reply. A real multi-part thread is posted in a short burst, so
 * a same-author reply that recent is almost certainly the same story
 * continuing, not a genuinely new, unrelated post.
 *
 * Deliberately NOT bypassed for urgent/top-priority handles — replying to
 * every segment of the SAME story is the bot-tell regardless of how
 * important the author is; priority should affect whether we engage with a
 * NEW story quickly, not how many times we reply to one story.
 */
const REDIS_KEY_PREFIX = "echo:last_replied_author:";
const RECENT_REPLY_WINDOW_MS = 45 * 60 * 1000; // 45 minutes

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, "").toLowerCase();
}

export async function recordAuthorReply(handle: string): Promise<void> {
  if (!handle) return;
  const key = REDIS_KEY_PREFIX + normalizeHandle(handle);
  await getRedisClient().set(key, Date.now().toString(), "PX", RECENT_REPLY_WINDOW_MS);
}

export async function repliedToAuthorRecently(handle: string): Promise<boolean> {
  if (!handle) return false;
  const key = REDIS_KEY_PREFIX + normalizeHandle(handle);
  const value = await getRedisClient().get(key);
  return value !== null;
}
