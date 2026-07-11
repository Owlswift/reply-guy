import { peek, dequeue, updateItem } from "../core/queue";
import { openTweet } from "../browser/openTweet";
import { backToTimeline } from "../reply/backToTimeline";
import { markReplied } from "../storage/repliedTweets";
import { log } from "../utils/logger";
import { Page } from "playwright";
import { reviewSession, ReviewSessionDetails } from "../cli/reviewSession";
import { stats } from "../stats/runtime";

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
      stats.tweets++;
      await openTweet(page, item.url);

      // Run the review session
      const details: ReviewSessionDetails = {
        id: item.id,
        author: item.author,
        text: item.text,
        relationship: item.relationship || "stranger",
        existingDraft: item.draft
      };
      
      const result = await reviewSession(page, details);

      if (result.status === "posted") {
        // Mark as replied
        markReplied(item.id);
        
        // Remove from queue
        dequeue();

        stats.posted++;

        console.log("\n✅ Reply posted.\n");
      } else if (result.status === "skipped") {
        // Remove from queue without replying
        dequeue();
        stats.skipped++;
        console.log("\nSkipped.\n");
      }

      // Go back to timeline with auto-scroll delay
      log("Returning to timeline...");
      await page.waitForTimeout(2000);
      await backToTimeline(page);
      await page.waitForTimeout(1000);
    } catch (err) {
      console.error(`Browser error for ${item.id}:`, err);
      updateItem(item.id, {
        status: "failed",
        attempts: (item.attempts || 0) + 1
      });
    }
  }
}