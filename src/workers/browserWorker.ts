import { peek, dequeue, updateItem } from "../core/queue";
import { openTweet } from "../browser/openTweet";
import { extractCurrentTweet } from "../browser/extractTweet";
import { markReplied } from "../storage/repliedTweets";
import { log } from "../utils/logger";
import { Page } from "playwright";
import { reviewSession, ReviewSessionDetails } from "../cli/reviewSession";
import { stats } from "../stats/runtime";
import { sessionManager } from "../core/sessionManager";

export async function runBrowserWorker(page: Page): Promise<void> {
  while (true) {
    // Check if review session is active - if so, wait
    if (sessionManager.isReviewing()) {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    const item = peek();

    if (!item) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    // Only process items that are "ready" and not already being processed
    if (item.status !== "ready") {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    // Lock the item to prevent race conditions
    updateItem(item.id, { status: "processing" });

    try {
      // Open the tweet first (needed for reply box)
      log(`Browser opening tweet ${item.id}`);
      stats.tweets++;
      await openTweet(page, item.url);

      // Extract current tweet details (including full thread)
      const details = await extractCurrentTweet(page);

      // Run the review session (which will open the reply box when approved)
      const reviewDetails: ReviewSessionDetails = {
        id: item.id,
        author: details.handle || item.author,
        text: details.fullText || details.text || item.text,
        relationship: item.relationship || "stranger",
        existingDraft: item.draft
      };
      
      const result = await reviewSession(page, reviewDetails);

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
      } else if (result.status === "regen") {
        // Regenerate - put back to ready for AI to regenerate
        updateItem(item.id, { 
          status: "ready",
          draft: result.draft
        });
      } else {
        // For cancelled, put back to ready
        updateItem(item.id, { status: "ready" });
      }
    } catch (err) {
      console.error(`Browser error for ${item.id}:`, err);
      updateItem(item.id, {
        status: "failed",
        attempts: (item.attempts || 0) + 1
      });
      // Remove from queue after max attempts to prevent infinite loop
      if ((item.attempts || 0) + 1 >= 3) {
        dequeue();
        console.log(`\n❌ Max attempts reached for ${item.id}, removing from queue.\n`);
      }
    }
  }
}