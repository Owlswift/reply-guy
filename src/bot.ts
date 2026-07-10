import { getPage } from "./browser/browser";
import { getTimelineTweets } from "./browser/timeline";
import { Page } from "playwright";
import { openTweet } from "./browser/openTweet";
import { shouldReply } from "./filter/filterTweet";
import { generateReply } from "./ai/ollama";
import { replyToTweet } from "./reply/reply";
import { backToTimeline } from "./reply/backToTimeline";
import { markReplied } from "./storage/repliedTweets";
import { scrollTimeline } from "./browser/scroll";
import { log } from "./utils/logger";
import { updateTimeline, timelineLooksStuck, resetTimelineState } from "./timeline/state";
import { shouldRefreshSession, markSessionRefreshed } from "./utils/session";
import { isLoggedIn } from "./browser/isLoggedIn";
import { getRelationship } from "./relationship/getRelationship";

const DRY_RUN = true;
const DAILY_LIMIT = 40;

// Random delay between min and max milliseconds
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function processTweet(page: Page, tweet: { id: string; author: string; text: string; url: string }): Promise<boolean> {
  try {
    // Open the tweet
    log(`Opening tweet ${tweet.id}`);
    await openTweet(page, tweet.url);

    // Add human delay
    await page.waitForTimeout(randomDelay(3000, 7000));

    // Get relationship
    log("Detecting relationship...");
    const relationship = await getRelationship(page);
    log(`Relationship: ${relationship}`);

    // Generate a reply
    log("Generating AI reply...");
    const reply = await generateReply(tweet.text, relationship);

    // Log the reply
    console.log(`
========================================
Author: ${tweet.author}
Tweet: ${tweet.text}
Generated reply: ${reply}
Status: ${DRY_RUN ? "HUMAN APPROVAL - NOT POSTED" : "READY TO POST"}
========================================
`);

    // Type and submit the reply
    log("Typing reply...");
    const success = await replyToTweet(page, reply, tweet.author);

    if (success) {
      // Mark as replied
      markReplied(tweet.id);
    }

    return success;
  } catch (err) {
    console.error(`Error processing tweet ${tweet.id}:`, err);
    return false;
  }
}

async function main() {
  const page = await getPage();
  let replyCount = 0;

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

      // Filter tweets
      const candidates = tweets.filter(shouldReply);

      if (candidates.length === 0) {
        log("No suitable tweets found, scrolling...");
        await scrollTimeline(page);
        continue;
      }

      // Pick a random tweet
      const tweet = candidates[Math.floor(Math.random() * candidates.length)];

      if (!tweet) {
        continue;
      }

      // Process the tweet
      const success = await processTweet(page, tweet);

      if (success) {
        replyCount++;
      }

      // Go back to timeline
      log("Returning to timeline...");
      await backToTimeline(page);

      // Random wait before next iteration
      const waitTime = randomDelay(20000, 60000);
      log(`Waiting ${waitTime / 1000}s before next reply...`);
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