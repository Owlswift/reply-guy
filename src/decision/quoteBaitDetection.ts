/**
 * A tweet whose own text is a call-to-action asking readers to quote-tweet
 * it ("Quote this tweet with...", "QT this with...") is engagement-bait —
 * designed purely to farm quote-tweet replies, not to say anything worth
 * reacting to. Skip it outright rather than replying to the CTA itself.
 */
const QUOTE_BAIT_PATTERNS: RegExp[] = [
  /\bquote\s+this\s+tweet\b/i,
  /\bquote\s+tweet\s+this\b/i,
  /\bquote\s+this\s+post\b/i,
  /\bquote\s+this\s+with\b/i,
  /\bqt\s+this\s+with\b/i,
  /\bqt\s+this\s+tweet\b/i,
];

export function isQuoteBaitTweet(text: string): boolean {
  return QUOTE_BAIT_PATTERNS.some(pattern => pattern.test(text));
}
