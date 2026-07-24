/**
 * Quoted-tweet text snippets that mean "skip this tweet entirely, don't
 * reply." Meant for viral engagement-bait tweets — a generic question
 * ("Worst wing flavor??") designed purely to attract a flood of unrelated
 * quote-tweet replies — where replying to whoever quoted it adds nothing
 * and just burns a reply slot on off-topic engagement farming.
 *
 * Matched as a case-insensitive substring against the quoted tweet's text
 * (extractTweet.ts's readQuotedTweet prefixes it with "@handle: "), so a
 * short distinctive fragment is enough — no need for exact full text or
 * punctuation to match. Add more snippets here as new bait tweets show up.
 */
const BLOCKED_QUOTED_TWEET_SNIPPETS: string[] = [
  "worst wing flavor",
];

export function isBlockedQuotedTweet(quotedTweet: string | undefined): boolean {
  if (!quotedTweet) return false;
  const normalized = quotedTweet.toLowerCase();
  return BLOCKED_QUOTED_TWEET_SNIPPETS.some(snippet => normalized.includes(snippet.toLowerCase()));
}
