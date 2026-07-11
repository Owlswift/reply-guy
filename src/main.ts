import { getPage } from "./browser/browser";
import { getTimelineTweets } from "./browser/timeline";
import { openTweet } from "./browser/openTweet";
import { extractCurrentTweet } from "./browser/extractTweet";
import { backToTimeline } from "./reply/backToTimeline";
import { isLoggedIn } from "./browser/isLoggedIn";
import { log } from "./utils/logger";
import { reviewSession } from "./cli/reviewSession";
import { DraftRepository } from "./database/DraftRepository";
import { shouldReply } from "./filter/filterTweet";
import { scrollTimeline } from "./browser/scroll";

const draftRepo = new DraftRepository();

// Startup checks
async function checkStartup(page: any) {
  console.log("Checking...");

  // Check Chrome
  try {
    console.log("✓ Chrome connected");
  } catch (err) {
    console.log("✗ Chrome connection failed");
    throw err;
  }

  // Check X auth
  try {
    const loggedIn = await isLoggedIn(page);
    if (!loggedIn) {
      console.log("✗ Not logged into X");
      throw new Error("Not logged into X");
    }
    console.log("✓ X authenticated");
  } catch (err) {
    console.log("✗ X authentication failed");
    throw err;
  }

  // Check Ollama
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      method: "GET"
    });
    if (!response.ok) throw new Error("Ollama not responding");
    console.log("✓ Ollama running");
  } catch (err) {
    console.log("✗ Ollama not running");
    throw err;
  }

  // Check database
  try {
    await draftRepo.hasDecision("test");
    console.log("✓ Database ready");
  } catch (err) {
    console.log("✗ Database connection failed");
    throw err;
  }

  console.log("\nEcho ready.\n");
}

// Process a single tweet
async function processTweet(page: any, tweet: { id: string; url: string; author: string; text: string }) {
  // Open the tweet
  await openTweet(page, tweet.url);

  // Extract current tweet details
  const details = await extractCurrentTweet(page);

  // Run review session
  const result = await reviewSession(page, {
    id: tweet.id,
    author: details.handle || tweet.author,
    text: details.text || tweet.text,
    relationship: "stranger",
    existingDraft: undefined
  });

  if (result.status === "posted") {
    // Save to database
    await draftRepo.saveDecision(
      tweet.id,
      result.finalReply || "",
      true
    );
  }

  // Go back to timeline
  await backToTimeline(page);
}

// Main loop
async function main() {
  const page = await getPage();

  // Startup checks
  await checkStartup(page);

  let tweetCount = 0;

  // Handle Ctrl+C
  process.on("SIGINT", async () => {
    console.log("\nStopping Echo...");
    await page.context().close();
    process.exit(0);
  });

  while (true) {
    try {
      // Check if still logged in
      if (!(await isLoggedIn(page))) {
        log("Session expired. Stopping bot.");
        break;
      }

      // Get timeline tweets
      log("Reading timeline...");
      const tweets = await getTimelineTweets(page);

      for (const tweet of tweets) {
        // Skip if already replied
        const alreadyReplied = await draftRepo.hasDecision(tweet.id);
        if (alreadyReplied) {
          continue;
        }

        // Skip if doesn't meet criteria
        if (!shouldReply(tweet)) {
          continue;
        }

        tweetCount++;

        // Show processing banner
        console.log("\n=========================================");
        console.log(`Tweet ${tweetCount}`);
        console.log(`@${tweet.author}`);
        console.log("=========================================\n");

        try {
          await processTweet(page, tweet);
        } catch (err) {
          console.error("Error processing tweet:", err);
          // Recover by going back to timeline
          await page.goto("https://x.com/home");
          await page.waitForTimeout(2000);
        }
      }

      // Refresh timeline
      log("Refreshing timeline...");
      await scrollTimeline(page);
    } catch (err) {
      console.error("Error in main loop:", err);
      // Recover
      await page.goto("https://x.com/home");
      await page.waitForTimeout(5000);
    }
  }
}

main().catch(console.error);