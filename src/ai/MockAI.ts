import { AIProvider } from "./AIProvider";
import { Draft } from "../types/draft";
import { Tweet } from "../types/tweet";

export class MockAI implements AIProvider {
  async generate(tweet: Tweet): Promise<Draft> {
    return {
      tweetId: tweet.id,
      shouldReply: true,
      confidence: 95,
      reason: "Mock response",
      reply:
        "This is a generated reply that will later come from OpenAI.",
    };
  }
}