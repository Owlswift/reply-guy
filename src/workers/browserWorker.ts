import { peek, dequeue, updateItem } from "../core/queue";
import { openTweet } from "../browser/openTweet";
import { extractCurrentTweet } from "../browser/extractTweet";
import { backToTimeline } from "../reply/backToTimeline";
import { scrollTimeline } from "../browser/scroll";
import { readDelay, betweenRepliesDelay, maybeDistractedPause } from "../behavior/profiles";
// These are no longer exported from scheduler — kept for reference
// import { shouldTakeBreak, getBreakDuration } from "../behavior/scheduler";
import { markReplied } from "../storage/repliedTweets";
import { markNotificationReplied, getNotificationProgress } from "../storage/seenNotifications";
import { log } from "../utils/logger";
import { Page } from "playwright";
import { reviewSession, ReviewSessionDetails } from "../cli/reviewSession";
import { stats } from "../stats/runtime";
import { sessionManager } from "../core/sessionManager";
import { BrowserNavigator } from "../browser/BrowserNavigator";

export async function runBrowserWorker(page: Page, navigator: BrowserNavigator): Promise<void> {
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
      log(`Opening tweet ${item.id}`);
      stats.tweets++;
      await navigator.openTweet(item.url);

      // Skip tweets we can't reply to (replies disabled, deleted, ad, protected,
      // different layout, etc.). These are expected when automating X — not errors.
      const replyButton = page.locator('[data-testid="reply"]').first();
      if (!(await replyButton.isVisible().catch(() => false))) {
        log(`Reply unavailable. Skipping.`);
        await navigator.returnToTimeline();
        dequeue();
        continue;
      }

      // Extract current tweet details (including full thread)
      const details = await extractCurrentTweet(page);

      if (!details) {
        log(`Cannot reply to tweet ${item.id}. Skipping.`);
        await navigator.returnToTimeline();
        dequeue();
        continue;
      }

      // Spend a human-like amount of time reading the tweet before replying,
      // scaled by how much content is on screen.
      const readTime = readDelay(details.fullText || details.text);
      log(`Reading tweet for ${(readTime / 1000).toFixed(1)}s...`);
      await page.waitForTimeout(readTime);

      // Run the review session (which will open the reply box when approved)
      const reviewDetails: ReviewSessionDetails = {
        id: item.id,
        author: details.handle || item.author,
        text: details.fullText || details.text || item.text,
        relationship: item.relationship || "stranger",
        existingDraft: item.draft
      };
      
      const result = await reviewSession(page, navigator, reviewDetails);

      if (result.status === "posted") {
        // Mark as replied
        markReplied(item.id);
        markNotificationReplied(item.id);
        
        // Remove from queue
        dequeue();

        stats.posted++;

        // Show updated progress
        const progress = getNotificationProgress();
        const remaining = progress.total - progress.replied;
        console.log(`\n✅ Reply posted. Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)\n`);

        // Longer pause after several replies (human-like break)
        // Commented out — replaced by session-based scheduler in main-interactive.ts
        // if (shouldTakeBreak(stats.posted)) {
        //   const breakMs = getBreakDuration();
        //   log(`Taking a longer break (${(breakMs / 60000).toFixed(0)} min)...`);
        //   await page.waitForTimeout(breakMs);
        // }
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

      // Human-like pause between replies — sometimes scroll a bit first
      if (Math.random() < 0.4) {
        await scrollTimeline(page);
      }
      const between = betweenRepliesDelay();
      log(`Pausing ${(between / 1000).toFixed(1)}s before next tweet...`);
      await page.waitForTimeout(between);

      // Distracted profile occasionally wanders off for a long pause
      const distracted = maybeDistractedPause();
      if (distracted > 0) {
        log(`Distracted — pausing ${(distracted / 1000).toFixed(0)}s...`);
        await page.waitForTimeout(distracted);
      }
    } catch (err) {
      // Any unexpected issue (timeout, layout change, browser glitch) is a normal
      // part of automating X. Log briefly and move on to the next tweet.
      log(`Cannot reply to tweet ${item.id}. Skipping.`);
      await navigator.returnToTimeline();
      dequeue();
    } finally {
      // Always leave the PROCESSING state, no matter how we exited, so the
      // timeline reader can resume extracting from the feed.
      sessionManager.endProcessing();
    }
  }
}
