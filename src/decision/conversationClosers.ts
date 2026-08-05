/**
 * Conversation closers — short, one-sided acknowledgments like "fr",
 * "exactly", "yes" that close a conversation without adding anything new.
 * The kind of message a real person sends when there's nothing left to say.
 *
 * Echo should never reply to these. They don't deserve a response — just
 * like (if a like action is available) and move on. Posting another "facts"
 * back to someone who said "facts" is exactly how an automated account
 * reads as a bot.
 *
 * Shared by:
 *   - engage/classifyReply.ts (the local LLM's keyword fallback — teaches
 *     the classifier to recognize these as CONVERSATION_CLOSER, not AGREEMENT)
 *   - main-interactive.ts (skipping conversation-closer posts in the
 *     notification feed before they ever reach the queue)
 */

// A closed set of normalized closer phrases. `isConversationCloser` first
// strips punctuation/emoji and collapses whitespace, then checks the result
// against this set — so "fr!", "fr 😭", "facts.", "exactly!" all normalize
// to a phrase that's in the set, while a longer reply that merely STARTS
// with one of these ("facts but here's what I actually think...") won't
// match because it's longer and contains non-closer words.
const CLOSERS = new Set([
  // Core one-word closers
  "fr", "frfr", "exactly", "yes", "yeah", "yep", "yup",
  "facts", "fact", "this", "true", "real", "same", "word", "bet",
  "period", "periodt", "valid", "fair", "agreed", "agree", "felt",
  "mood", "ong", "deadass", "preach", "lmao", "lol", "lmfao",
  "100", "100%",

  // Common multi-word closers
  "fr fr", "facts fr", "exactly this", "this fr", "true that",
  "true tho", "true though", "real talk", "real shit", "real asf",
  "same here", "same honestly", "whole mood", "felt that",
  "no cap", "for sure", "say less", "big facts", "fair enough",
  "so true", "so real", "too real", "too true", "so valid",
  "valid af", "real af", "same fr", "exactly fr", "yes fr",
  "lmaooo", "lmfaooo", "lmaooo fr", "facts fr", "real fr",
  "ong fr", "deadass fr", "lol fr", "frfr fr", "fr no cap",

  // Expanded closers — acknowledging the post without engaging
  "ok", "okay", "k", "got it", "gotcha", "understand", "understood",
  "makes sense", "that makes sense", "i see", "i hear you",
  "thanks", "thank you", "appreciate it", "appreciated",
  "well said", "said well", "good point", "great point",
  "nice", "good", "great", "cool", "awesome", "dope", "fire",
  "tight", "solid", "sick", "lit", "amazing", "love it", "love this",
]);

/** How long a normalized closer can be (tokens) — "fr", "facts", "same here". */
const MAX_CLOSER_WORDS = 6;

/**
 * Is this text a conversation closer — a short acknowledgment that doesn't
 * invite or deserve a response?
 *
 * Rules:
 *   - Strip punctuation/emoji and collapse whitespace before matching.
 *   - Must be short (<= MAX_CLOSER_WORDS tokens) — longer replies that
 *     happen to start with "facts" are real responses, not closers.
 *   - Questions are never closers ("real?" is a genuine ask).
 *   - The normalized text must be entirely in the CLOSERS set.
 */
export function isConversationCloser(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // Questions are never conversation closers — "facts?" is asking for
  // confirmation, not closing anything.
  if (t.includes("?")) return false;

  // Normalize: lowercase, strip punctuation and emoji, collapse whitespace.
  const normalized = t
    .toLowerCase()
    .replace(/[.,!']+/g, " ")
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;

  const words = normalized.split(" ");
  if (words.length > MAX_CLOSER_WORDS) return false;

  return CLOSERS.has(normalized);
}