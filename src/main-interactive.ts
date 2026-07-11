import "dotenv/config";
import { getPage } from "./browser/browser";
import { shouldReply } from "./filter/filterTweet";
import { scrollTimeline } from "./browser/scroll";
import { log } from "./utils/logger";
import { updateTimeline, timelineLooksStuck, resetTimelineState } from "./timeline/state";
import { shouldRefreshSession, markSessionRefreshed } from "./utils/session";
import { isLoggedIn } from "./browser/isLoggedIn";
import { enqueue, queueSize, getQueue, QueueItem } from "./core/queue";
import { runAIWorker } from "./workers/aiWorker";
import { runBrowserWorker } from "./workers/browserWorker";
import { sessionManager } from "./core/sessionManager";
import { SourceManager } from "./sources/SourceManager";
import { HomeTimelineSource } from "./sources/HomeTimelineSource";
import { NotificationFeedSource } from "./sources/NotificationFeedSource";
import { deduplicateTweets } from "./sources/deduplicate";
import { hasTweet } from "./database/tweetRepository";
import { markNotificationSeen, getNotificationProgress } from "./storage/seenNotifications";

const DAILY_LIMIT = 40;

// Random delay between min and max milliseconds
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const page = await getPage();
  let replyCount = 0;

  // Start workers
  runAIWorker();
  runBrowserWorker(page);

  // Define source manager
  const sourceManager = new SourceManager([
    new NotificationFeedSource(),
    new HomeTimelineSource()
  ]);

  while (replyCount < DAILY_LIMIT) {
    // Check if review session is active - if so, wait
    if (sessionManager.isReviewing()) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    try {
      // Check if still logged in
      if (!(await isLoggedIn(page))) {
        log("Session expired. Stopping bot.");
        break;
      }

      // Check if we should refresh the session
      if (shouldRefreshSession()) {
        log("Refreshing session...");
        await page.goto("https://x.com/i/timeline", {
          waitUntil: "networkidle"
        });
        markSessionRefreshed();
      }

      // Get tweets from all sources
      const rawTweets = await sourceManager.getTweets(page);

      // Deduplicate tweets
      const tweets = deduplicateTweets(rawTweets);

      // Log statistics
      const duplicateCount = rawTweets.length - tweets.length;
      log(`Merged: ${tweets.length} tweets, ${duplicateCount} duplicates removed`);

      // Log each extracted post with its URL
      if (tweets.length > 0) {
        console.log("\n📋 Extracted posts:");
        for (const t of tweets) {
          console.log(`   [${t.id}] ${t.author} — ${t.url}`);
        }
        console.log();
      }

      // Update timeline state
      updateTimeline(tweets.map(t => t.id));

      // Check if timeline is stuck
      if (timelineLooksStuck()) {
        log("Timeline appears stuck. Refreshing...");
        await page.goto("https://x.com/i/timeline", {
          waitUntil: "networkidle"
        });
        resetTimelineState();
        continue;
      }

      // Enqueue tweets (only if not already in queue or already replied)
      for (const tweet of tweets) {
        // Skip if already replied
        if (hasTweet(tweet.id)) {
          continue;
        }
        
        if (shouldReply(tweet)) {
          // Check if already in queue
          const existing = getQueue().find((q: QueueItem) => q.id === tweet.id);
          if (!existing) {
            const item: QueueItem = {
              id: tweet.id,
              url: tweet.url,
              author: tweet.author,
              text: tweet.text,
              createdAt: Date.now(),
              status: "pending"
            };
            enqueue(item);
          }
        }

        // Mark tweet as seen in persistent storage so it's never re-processed
        markNotificationSeen(tweet.id, tweet.url);
      }

      // Show progress summary after processing all tweets
      const progress = getNotificationProgress();
      const remaining = progress.total - progress.replied;
      console.log(`📊 Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)`);

      // Keep queue topped up
      if (queueSize() < 10) {
        log("Queue low, scrolling...");
        await scrollTimeline(page);
      }

      // Random wait before next iteration
      const waitTime = randomDelay(20000, 60000);
      log(`Waiting ${waitTime / 1000}s before next check...`);
      await page.waitForTimeout(waitTime);
    } catch (err) {
      console.error("Error in main loop:", err);
      log("Recovering by going to i/timeline...");
      await page.goto("https://x.com/i/timeline");
      await page.waitForTimeout(5000);
    }
  }

  log(`Completed ${replyCount} replies today.`);
}

main().catch(console.error);