import { TimelineTweet } from "../types/tweet";
import { relationshipScore } from "./relationship";

export function scoreTweet(tweet: TimelineTweet): number {
  let score = 0;

  score += relationshipScore(tweet);

  return score;
}
