import { TwitterSource } from "../sources/TwitterSource";

async function main() {
  const source = new TwitterSource();
  const tweets = await source.fetch();

  console.log(`Found ${tweets.length} tweets\n`);

  for (const tweet of tweets) {
    console.log(`@${tweet.authorHandle}`);
    console.log(`${tweet.text}\n`);
  }
}

main().catch(console.error);