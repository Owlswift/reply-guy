import "dotenv/config";
import { getPage } from "./browser/browser";
import { getTimelineTweets } from "./browser/timeline";
import { openTweet } from "./browser/openTweet";
import { extractCurrentTweet } from "./browser/extractTweet";
import { replyToTweet } from "./reply/reply";
import { generateReply } from "./ai/generateReply";
import { buildPersonalityPrompt } from "./personality/prompt";
import { validateReply } from "./personality/validator";
import { isDuplicate } from "./personality/duplicate";
import { getRelationship } from "./relationship/getRelationship";
import { classifyTweet } from "./ai/classifyTweet";
import { shouldReply } from "./decision/shouldReply";
import { saveTweet, hasTweet } from "./database/tweetRepository";
import { saveReply } from "./database/replyRepository";
import { log } from "./database/logRepository";
import { sleepRandom } from "./utils/sleep";

async function run() {
  console.log("Starting Echo...");

  const page = await getPage();

  while (true) {
    console.log("\nLoading timeline...");

    const tweets = await getTimelineTweets(page);
    console.log(`Found ${tweets.length} tweets`);

    for (const tweet of tweets) {
      // Skip if already replied
      if (hasTweet(tweet.id)) {
        console.log(`Skipping ${tweet.id} - already replied`);
        continue;
      }

      console.log(`\nProcessing: ${tweet.author}`);

      // Open tweet
      await openTweet(page, tweet.url);
      await sleepRandom(2000, 4000);

      // Extract details
      const details = await extractCurrentTweet(page);

      // Skip if we couldn't extract the tweet (deleted, layout changed, etc.)
      if (!details) {
        console.log("No text extracted, skipping");
        await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
        continue;
      }

      // Get relationship and classify
      const relationship = await getRelationship(page);
      const tweetType = classifyTweet(details.text);

      // Build TimelineTweet for decision engine with relationship info
      const timelineTweet = {
        ...tweet,
        verified: relationship === "verified",
        source: "timeline" as const
      };

      // Decide whether to reply
      const decision = shouldReply(timelineTweet);
      console.log(`Decision: ${decision.reply ? "REPLY" : "SKIP"} (score: ${decision.score}, reason: ${decision.reason})`);

      if (!decision.reply) {
        // Save tweet for tracking
        saveTweet({
          tweet_id: tweet.id,
          author: details.author,
          text: details.text,
          url: details.url,
          scraped_at: Date.now().toString()
        });

        // Go back to timeline
        await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
        await sleepRandom(1000, 2000);
        continue;
      }

       // Build prompt with personality
       const prompt = buildPersonalityPrompt(details.text, relationship, tweetType, []);

      // Generate reply with validation
      let reply = "";
      for (let i = 0; i < 3; i++) {
        reply = await generateReply(prompt);

        if (validateReply(reply) && !isDuplicate(reply)) {
          break;
        }

        console.log(`Retry ${i + 1} - invalid or duplicate reply`);
      }

      if (!reply) {
        console.log("Failed to generate valid reply");
        await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
        continue;
      }

      console.log(`Generated: ${reply}`);

      // Post reply
      const success = await replyToTweet(page, reply, details.author);

      // Save to database
      saveTweet({
        tweet_id: tweet.id,
        author: details.author,
        text: details.text,
        url: details.url,
        scraped_at: Date.now().toString()
      });

      saveReply({
        task_id: `task-${tweet.id}`,
        tweet_id: tweet.id,
        draft: reply,
        final_reply: reply,
        status: success ? "posted" : "failed",
        created_at: Date.now().toString()
      });

      log(success ? "info" : "error", `Reply to ${tweet.id}: ${success ? "success" : "failed"}`);

      // Go back to timeline
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
      await sleepRandom(3000, 6000);
    }

    console.log("\nRefreshing timeline...");
    await page.reload();
    await page.waitForTimeout(15000);
  }
}

run().catch((err) => {
  log("error", `Fatal error: ${err.message}`);
  console.error(err);
});