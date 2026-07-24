/**
 * Specific tweet IDs to never open, process, or reply to — for a one-off
 * tweet that isn't from a blocked handle and doesn't match a blocked-quote
 * snippet, but still shouldn't be engaged with. Coarser blocks (BLOCKED_HANDLES
 * in scoreTweet.ts, BLOCKED_QUOTED_TWEET_SNIPPETS in blockedQuotedTweets.ts)
 * don't cover this case: blocking by exact tweet id.
 *
 * Add the numeric id from the tweet's URL (x.com/<handle>/status/<id>).
 */
const BLOCKED_TWEET_IDS: string[] = [
  "2080445431708778833",
];

export function isBlockedTweetId(id: string | undefined): boolean {
  if (!id) return false;
  return BLOCKED_TWEET_IDS.includes(id);
}
