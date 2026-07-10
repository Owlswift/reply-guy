import { TimelineTweet } from "../types/tweet";

export function relationshipScore(tweet: TimelineTweet): number {
  let score = 0;

  if (tweet.following) score += 40;
  if (tweet.followsYou) score += 40;
  if (tweet.following && tweet.followsYou) score += 30;

  return score;
}