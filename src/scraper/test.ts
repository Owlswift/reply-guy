import { getPage } from "../browser/browser";
import { getTimelineTweets } from "../browser/timeline";
import { generateReply } from "../ai/ollama";

async function main() {
  const page = await getPage();

  const tweets = await getTimelineTweets(page);

  for (const tweet of tweets) {
    console.log("\n--------------------");
    console.log("Tweet:");
    console.log(tweet.text);

    const reply = await generateReply(tweet.text);

    console.log("\nSuggested reply:");
    console.log(reply);
  }
}

main();