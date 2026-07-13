import { TimelineTweet } from "../types/tweet";
import { scoreTweet, shouldSkipDueToAgeAndReplies, isUrgent } from "./scoreTweet";
import { isSpam } from "./filters";

export interface Decision {
  reply: boolean;
  score: number;
  reason: string;
}

export function shouldReply(tweet: TimelineTweet): Decision {
  const urgent = isUrgent(tweet.author, tweet.username);

  // Urgent handles (e.g. @WatcherGuru) bypass spam filters
  if (!urgent && isSpam(tweet.text)) {
    return {
      reply: false,
      score: 0,
      reason: "Spam"
    };
  }

  // Skip tweets that are too old and too saturated (urgent handles bypass this)
  if (shouldSkipDueToAgeAndReplies(tweet)) {
    return {
      reply: false,
      score: 0,
      reason: "Too old / too saturated"
    };
  }

  const score = scoreTweet(tweet);

  // Urgent handles bypass the score threshold — always reply
  if (urgent) {
    return {
      reply: true,
      score,
      reason: "Urgent handle — always reply"
    };
  }

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
