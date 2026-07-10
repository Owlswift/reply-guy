import { TimelineTweet } from "../browser/timeline";
import { hasReplied } from "../storage/repliedTweets";

const bannedWords = [
  "giveaway",
  "follow me",
  "airdrop",
  "crypto",
  "bitcoin",
  "casino",
  "betting",
  "porn",
  "nsfw",
  "adult",
  "boost",
  "follow for follow",
  "f4f",
  "l4l",
  "like for like"
];

export function shouldReply(tweet: TimelineTweet): boolean {
  if (!tweet.text.trim())
    return false;

  if (tweet.text.length < 25)
    return false;

  const lower = tweet.text.toLowerCase();

  if (bannedWords.some(word => lower.includes(word)))
    return false;

  // Check if we've already replied to this tweet
  if (hasReplied(tweet.id))
    return false;

  return true;
}