import { TimelineTweet } from "../types/tweet";
import { relationshipScore } from "./relationship";

export function scoreTweet(tweet: TimelineTweet): number {
  let score = 0;

  score += relationshipScore(tweet);

  // Engagement scoring
  if (tweet.likes > 100) score += 20;
  else if (tweet.likes > 50) score += 10;
  else if (tweet.likes > 10) score += 5;

  if (tweet.replies > 10) score += 10;
  else if (tweet.replies > 3) score += 5;

  return score;
}
