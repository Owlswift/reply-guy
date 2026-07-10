import { Tweet } from "../types/tweet";
import { AnalysisResult } from "../types/analysis";
import { Draft } from "../types/draft";

export function displayHeader(tweets: Tweet[]): void {
  console.log("\n" + "─".repeat(56));
  console.log(`  Found ${tweets.length} tweets`);
  console.log("─".repeat(56) + "\n");
}

export function displayTweet(tweet: Tweet, index: number, total: number): void {
  console.log("─".repeat(56));
  console.log(`  ${index} of ${total}`);
  console.log();
  console.log(`  @${tweet.authorHandle}`);
  console.log();
  console.log(`  ${tweet.text}`);
  console.log("─".repeat(56));
}

export function displayAnalysis(analysis: AnalysisResult): void {
  console.log();
  console.log("  Analysis");
  console.log("  " + "─".repeat(20));
  console.log(`  ${analysis.shouldReply ? "★★★★★" : "☆☆☆☆☆"}`);
  console.log();
  console.log(`  Reason`);
  console.log();
  console.log(`  ${analysis.reason}`);
  console.log();
}

export function displayDraft(draft: Draft): void {
  console.log("  Done.");
  console.log();
  console.log("─".repeat(56));
  console.log("  Suggested reply");
  console.log();
  console.log(`  ${draft.reply}`);
  console.log("─".repeat(56));
  console.log();
}