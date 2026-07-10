import { getPage } from "../browser/browser";
import { getTimelineTweets } from "../browser/timeline";
import { openTweet } from "../browser/openTweet";
import { generateReply } from "../ai/generateReply";
import { replyToTweet, verifyPostButton } from "./reply";
import { shouldReply } from "../filter/filterTweet";

// Random delay between min and max milliseconds
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const page = await getPage();

  // Ensure we're on the home page
  if (!page.url().includes("x.com")) {
    await page.goto("https://x.com/home");
  }

  const tweets = await getTimelineTweets(page);

  // Filter tweets
  const candidates = tweets.filter(shouldReply);

  if (candidates.length === 0) {
    console.log("No suitable tweets found");
    return;
  }

  // Pick a random tweet
  const selectedTweet = candidates[Math.floor(Math.random() * candidates.length)];

  if (!selectedTweet) {
    console.log("No tweet selected");
    return;
  }

  console.log("Selected tweet:", selectedTweet);

  // Open the tweet
  await openTweet(page, selectedTweet.url);

  // Add human delay
  await page.waitForTimeout(randomDelay(3000, 7000));

  // Generate a reply
  const reply = await generateReply(selectedTweet.text);

  console.log("Generated reply:", reply);

  // Type the reply (but don't post)
  await replyToTweet(page, reply);

  // Verify the post button exists
  const buttonCount = await verifyPostButton(page);
  console.log("Post button count:", buttonCount);

  // Keep the page open for inspection
  await page.waitForTimeout(60000);
}

main();