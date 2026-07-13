import { TimelineTweet } from "../types/tweet";
import { shouldReply as decideShouldReply, Decision } from "../decision/shouldReply";
import { hasReplied } from "../storage/repliedTweets";

/**
 * Accept tweets from both the new types/tweet module and the legacy browser/timeline module.
 * Legacy timeline.ts returns tweets without `createdAt`, so we fill in defaults.
 */
export function shouldReply(tweet: TimelineTweet | { id: string; text: string; verified: boolean; replies?: number; createdAt?: Date }): boolean {
  // Check if we've already replied to this tweet
  if (hasReplied(tweet.id))
    return false;

  // Normalize to full TimelineTweet (fill in defaults for legacy tweets)
  const fullTweet: TimelineTweet = {
    id: tweet.id,
    author: (tweet as any).author || "",
    username: (tweet as any).username || "",
    text: tweet.text,
    url: (tweet as any).url || "",
    verified: tweet.verified,
    following: (tweet as any).following || false,
    followsYou: (tweet as any).followsYou || false,
    likes: (tweet as any).likes || 0,
    replies: tweet.replies ?? 0,
    reposts: (tweet as any).reposts || 0,
    source: (tweet as any).source || "timeline",
    createdAt: tweet.createdAt || new Date()
  };

  // Use the priority-driven decision engine
  const decision: Decision = decideShouldReply(fullTweet);
  return decision.reply;
}
