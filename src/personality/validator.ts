import { isLikelyAiErrorMessage } from "../ai/errorDetection";

export function validateReply(reply: string): boolean {
  const trimmed = reply.trim();

  if (trimmed.toLowerCase().startsWith("certainly")) return false;
  if (trimmed.toLowerCase().startsWith("sure")) return false;
  if (trimmed.length < 5) return false;
  if (trimmed.length > 270) return false;

  // Em dashes (and double-hyphens used the same way) are one of the most
  // recognizable "written by AI" tells and instantly give away that a
  // reply wasn't typed by a person. The prompt already asks the model not
  // to use them, but that's not reliably followed — reject and force a
  // regeneration instead of trusting the instruction alone.
  if (trimmed.includes("—") || /\w\s--\s\w/.test(trimmed)) return false;

  // Reject HTML tags (indicates error page or malformed response)
  if (trimmed.includes('<div') || trimmed.includes('<span') || trimmed.includes('<html') || 
      trimmed.includes('<body') || trimmed.includes('<h1') || trimmed.includes('<h2')) {
    return false;
  }

  // Reject common error messages — shared list across every provider
  // (src/ai/errorDetection.ts), same list the provider clients themselves
  // check. This is the second line of defense: a provider-specific error
  // phrase discovered later only needs to be added there once to cover
  // both checks, instead of drifting out of sync between two copies.
  if (isLikelyAiErrorMessage(trimmed)) {
    return false;
  }

  // ─── Prohibited starting phrases ───────────────────────────────────────────
  // Uses regex: match the phrase at the start, followed by any non-letter char
  // (punctuation, space, colon, dash, etc.) or end-of-string.
  // This catches "One thing I'd add:", "One thing I'd add,", "One thing I'd add —",
  // "One thing I'd add." etc. without needing every exact punctuation variant.
  const prohibitedStartsRaw = [
    "one thing i'd add",
    "one thing to add",
    "if that's really what happened",
    "if that's true",
    "if this happened",
    "if that happened",
    // "wild" alone catches "Wild,", "Wild that...", "Wild how..." (the
    // word-boundary check below stops it from also matching "wildly").
    "wild",
    "that's wild",
  ];

  const lowerReplyTrimmed = trimmed.toLowerCase().trimStart();
  for (const phrase of prohibitedStartsRaw) {
    // Check if reply starts with the exact phrase followed by non-letter or end
    if (lowerReplyTrimmed.startsWith(phrase)) {
      const remainder = lowerReplyTrimmed.slice(phrase.length);
      // If nothing left (exact match) or next char isn't a letter, it's a match
      if (remainder.length === 0 || !/^[a-z]/.test(remainder)) {
        return false;
      }
    }
  }

  // Additional check: reject if reply contains these phrases anywhere in the first 100 chars
  const prohibitedAnywhere = [
    "one thing i'd add",
    "one thing to add",
    "that's really what happened",
    "if that's really what happened",
    "if that's true",
  ];

  const lowerReplyFirst100 = trimmed.toLowerCase().substring(0, 100);
  if (prohibitedAnywhere.some(phrase => lowerReplyFirst100.includes(phrase))) {
    return false;
  }

  return true;
}