import { Draft } from "../types/draft";
import { Tweet } from "../types/tweet";

export function printTweet(tweet: Tweet) {
  console.log("=".repeat(60));
  console.log(`@${tweet.authorHandle}`);
  console.log();
  console.log(tweet.text);
  console.log("=".repeat(60));
}

export function printDraft(draft: Draft) {
  console.log(`Reply: ${draft.shouldReply ? "YES" : "NO"}`);
  console.log(`Confidence: ${draft.confidence}%`);
  console.log(`Reason: ${draft.reason}`);
  console.log();
  console.log("Suggested Reply:");
  console.log(draft.reply);
  console.log();
}