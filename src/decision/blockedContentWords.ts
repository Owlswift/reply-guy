/**
 * Explicit sexual-content words/phrases — a tweet containing any of these
 * (case-insensitive, whole word) is skipped outright, regardless of
 * author/priority/urgent status. Not the kind of content this account
 * should ever be seen replying to.
 */
const BLOCKED_CONTENT_WORDS: string[] = [
  "cum",
  "cumming",
  "bdsm",
  "pussy"
];

/**
 * Returns the specific blocked word found in the text, or null if none
 * matched — the caller uses the word itself as the skip reason instead of
 * a generic "blocked content" label.
 */
export function findBlockedContentWord(text: string): string | null {
  for (const word of BLOCKED_CONTENT_WORDS) {
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    if (pattern.test(text)) return word;
  }
  return null;
}
