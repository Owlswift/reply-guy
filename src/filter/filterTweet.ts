import { TimelineTweet } from "../browser/timeline";
import { hasReplied } from "../storage/repliedTweets";

export function shouldReply(tweet: TimelineTweet): boolean {
  // Only reply to verified accounts
  if (!tweet.verified)
    return false;

  // Check if we've already replied to this tweet
  if (hasReplied(tweet.id))
    return false;

  return true;
}
