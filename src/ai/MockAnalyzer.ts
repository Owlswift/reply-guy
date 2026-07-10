import { Analyzer } from "./Analyzer";
import { Tweet } from "../types/tweet";
import { AnalysisResult } from "../types/analysis";

export class MockAnalyzer implements Analyzer {
  async analyze(tweet: Tweet): Promise<AnalysisResult> {
    return {
      tweetId: tweet.id,
      shouldReply: true,
      confidence: 87,
      reason: "The tweet raises a debatable point worth engaging with.",
    };
  }
}