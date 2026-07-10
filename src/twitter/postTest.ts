import { twitterV2 } from "./TwitterClient";

async function main() {
  const result = await twitterV2.tweet(
    `Echo test ${new Date().toISOString()}`
  );

  console.log(result.data);
}

main().catch(console.error);
