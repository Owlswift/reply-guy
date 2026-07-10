import { ReplyGenerator } from "./ReplyGenerator";
import { Tweet } from "../types/tweet";
import { AnalysisResult } from "../types/analysis";
import { Draft } from "../types/draft";

export class MockReplyGenerator implements ReplyGenerator {
  async generate(tweet: Tweet, analysis: AnalysisResult): Promise<Draft> {
    return {
      tweetId: tweet.id,
      reply: `This is a thoughtful reply to @${tweet.authorHandle}'s post about "${tweet.text.slice(0, 40)}..."`,
    };
  }
}