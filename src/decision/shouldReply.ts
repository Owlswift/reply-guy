import { TimelineTweet } from "../types/tweet";
import { scoreTweet } from "./scoreTweet";
import { isSpam } from "./filters";

export interface Decision {
  reply: boolean;
  score: number;
  reason: string;
}

export function shouldReply(tweet: TimelineTweet): Decision {
  if (isSpam(tweet.text)) {
    return {
      reply: false,
      score: 0,
      reason: "Spam"
    };
  }

  const score = scoreTweet(tweet);

  if (score >= 20) {
    return {
      reply: true,
      score,
      reason: "Score above threshold"
    };
  }

  return {
    reply: false,
    score,
    reason: "Low score"
  };
}