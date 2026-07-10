import { getPage } from "./browser";
import { getTimelineTweets } from "./timeline";
import { openTweet } from "./openTweet";
import { extractCurrentTweet } from "./extractTweet";
import { generateReply } from "../ai/generateReply";

async function main() {
  const page = await getPage();

  const tweets = await getTimelineTweets(page);

  const tweet = tweets[0];

  if (!tweet) {
    console.log("No tweets found");
    return;
  }

  await openTweet(page, tweet.url);

  const details = await extractCurrentTweet(page);

  console.log("Extracted tweet:", details);

  const draft = await generateReply(details.text);

  console.log("AI Draft:", draft);

  await page.waitForTimeout(60000);
}

main();