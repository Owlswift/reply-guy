import { TimelineTweet } from "../types/tweet";

export function relationshipScore(tweet: TimelineTweet): number {
  let score = 0;

  // Verified users get a high score
  if (tweet.verified) score += 50;

  return score;
}
