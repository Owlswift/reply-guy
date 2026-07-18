import { Page } from "playwright";
import { visitProfileForNewOriginals } from "../browser/visitProfile";
import { ensureTracked, getDueHandles, recordCheck } from "../storage/priorityHandles";
import { hasReplied } from "../storage/repliedTweets";
import { enqueue, getQueue, QueueItem } from "../core/queue";
import { log } from "../utils/logger";

// Stagger checks throughout the interval instead of visiting every due
// handle back to back — reads as a person casually checking profiles, not
// a bot sweeping a list.
const MIN_JITTER_MS = 90_000;       // 1.5 min
const MAX_JITTER_MS = 5 * 60_000;   // 5 min
// How often to re-poll "is anything due yet" when nothing currently is.
const IDLE_POLL_MS = 60_000;

function jitter(): number {
  return MIN_JITTER_MS + Math.random() * (MAX_JITTER_MS - MIN_JITTER_MS);
}

/**
 * Priority Handles Worker — proactively visits tracked profiles to catch
 * original posts that a purely notification-driven bot would only see if
 * the author happened to also @-mention or reply to it.
 *
 * Runs forever on its own page (a separate tab), independent of the main
 * notification-watching loop in main-interactive.ts. Each handle has its
 * own adaptive check interval (storage/priorityHandles.ts) so frequent
 * posters get checked more often than quiet ones, rather than one fixed
 * interval for everybody.
 */
export async function runPriorityHandleWorker(page: Page, handles: string[]): Promise<void> {
  if (handles.length === 0) return;

  ensureTracked(handles);

  while (true) {
    try {
      const due = getDueHandles(handles);
      const handle = due[0];

      if (!handle) {
        await new Promise(r => setTimeout(r, IDLE_POLL_MS));
        continue;
      }

      log(`[PriorityHandles] Checking @${handle.username}...`);
      const { newOriginals, newestTweetId } = await visitProfileForNewOriginals(
        page,
        handle.username,
        handle.lastSeenTweetId
      );

      let enqueuedCount = 0;
      for (const tweet of newOriginals) {
        if (hasReplied(tweet.id)) continue;
        if (getQueue().find((q: QueueItem) => q.id === tweet.id)) continue;

        enqueue({
          id: tweet.id,
          url: tweet.url,
          author: tweet.author,
          text: tweet.text,
          createdAt: Date.now(),
          status: "pending",
        });
        enqueuedCount++;
      }

      recordCheck(handle.username, newestTweetId, newOriginals.length);

      log(
        enqueuedCount > 0
          ? `[PriorityHandles] @${handle.username}: ${enqueuedCount} new original post(s) enqueued.`
          : `[PriorityHandles] @${handle.username}: nothing new.`
      );
    } catch (err) {
      log(`[PriorityHandles] worker error, continuing: ${err}`);
    }

    await new Promise(r => setTimeout(r, jitter()));
  }
}
