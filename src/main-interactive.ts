import { getPage } from "./browser/browser";
import { getTimelineTweets } from "./browser/timeline";
import { shouldReply } from "./filter/filterTweet";
import { scrollTimeline } from "./browser/scroll";
import { log } from "./utils/logger";
import { updateTimeline, timelineLooksStuck, resetTimelineState } from "./timeline/state";
import { shouldRefreshSession, markSessionRefreshed } from "./utils/session";
import { isLoggedIn } from "./browser/isLoggedIn";
import { enqueue, queueSize, QueueItem } from "./core/queue";
import { runAIWorker } from "./workers/aiWorker";
import { runBrowserWorker } from "./workers/browserWorker";

const DAILY_LIMIT = 40;

// Random delay between min and max milliseconds
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const page = await getPage();
  let replyCount = 0;

  // Start workers
  runAIWorker(page);
  runBrowserWorker(page);

  while (replyCount < DAILY_LIMIT) {
    try {
      // Check if still logged in
      if (!(await isLoggedIn(page))) {
        log("Session expired. Stopping bot.");
        break;
      }

      // Check if we should refresh the session
      if (shouldRefreshSession()) {
        log("Refreshing session...");
        await page.goto("https://x.com/home", {
          waitUntil: "networkidle"
        });
        markSessionRefreshed();
      }

      // Get timeline tweets
      log("Reading timeline...");
      const tweets = await getTimelineTweets(page);

      // Update timeline state
      updateTimeline(tweets.map(t => t.id));

      // Check if timeline is stuck
      if (timelineLooksStuck()) {
        log("Timeline appears stuck. Refreshing...");
        await page.goto("https://x.com/home", {
          waitUntil: "networkidle"
        });
        resetTimelineState();
        continue;
      }

      // Enqueue tweets
      for (const tweet of tweets) {
        if (shouldReply(tweet)) {
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
      log("Recovering by going to home timeline...");
      await page.goto("https://x.com/home");
      await page.waitForTimeout(5000);
    }
  }

  log(`Completed ${replyCount} replies today.`);
}

main().catch(console.error);