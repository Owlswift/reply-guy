import "dotenv/config";
import { tweets } from "./mock/tweets";
import { generateReply } from "./ai/openai";

/**
 * Test runner for Milestone 2.
 *
 * Loads sample tweets, sends each to OpenAI, and prints the structured
 * responses. No database, no X, no Express — just the AI pipeline.
 */
async function main() {
  console.log("🔍 Evaluating tweets...\n");

  for (const tweet of tweets) {
    console.log(`─── Tweet by @${tweet.author} ───`);
    console.log(`"${tweet.text}"\n`);

    try {
      const result = await generateReply(tweet.text);

      console.log("  Result:");
      console.log(`    shouldReply: ${result.shouldReply}`);
      console.log(`    confidence:  ${result.confidence}/100`);
      console.log(`    reason:      ${result.reason}`);
      console.log(`    reply:       ${result.reply}\n`);
    } catch (error) {
      console.error(`  Error evaluating tweet: ${error}\n`);
    }
  }
}

main();