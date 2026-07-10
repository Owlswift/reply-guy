import { peek, dequeue, updateItem, QueueItem } from "../core/queue";
import { openTweet } from "../browser/openTweet";
import { replyToTweet } from "../reply/reply";
import { backToTimeline } from "../reply/backToTimeline";
import { markReplied } from "../storage/repliedTweets";
import { log } from "../utils/logger";
import { Page } from "playwright";

const DRY_RUN = true;

export async function runBrowserWorker(page: Page): Promise<void> {
  while (true) {
    const item = peek();

    if (!item) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    if (item.status !== "ready") {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    try {
      // Open the tweet
      log(`Browser opening tweet ${item.id}`);
      await openTweet(page, item.url);

      // Type and submit the reply
      log(`Browser typing reply for ${item.id}`);
      const success = await replyToTweet(page, item.draft!, item.author);

      if (success) {
        // Mark as replied
        markReplied(item.id);
        
        // Remove from queue
        dequeue();
      } else {
        log(`Reply failed for ${item.id}`);
        updateItem(item.id, {
          status: "failed",
          attempts: (item.attempts || 0) + 1
        });
      }

      // Go back to timeline
      log("Returning to timeline...");
      await backToTimeline(page);
    } catch (err) {
      console.error(`Browser error for ${item.id}:`, err);
      updateItem(item.id, {
        status: "failed",
        attempts: (item.attempts || 0) + 1
      });
    }
  }
}