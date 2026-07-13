import { TimelineTweet } from "../types/tweet";
import { scoreTweet, shouldSkipDueToAgeAndReplies } from "./scoreTweet";
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

  // Skip tweets that are too old and too saturated
  if (shouldSkipDueToAgeAndReplies(tweet)) {
    return {
      reply: false,
      score: 0,
      reason: "Too old / too saturated"
    };
  }

  const score = scoreTweet(tweet);

  // With the new 0-100 scoring, require at least 30 to reply
  if (score >= 30) {
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
