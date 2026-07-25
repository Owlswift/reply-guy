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

  // Reject common error messages
  const errorPatterns = [
    "enable javascript",
    "enable cookies",
    "challenge-error",
    "verify you are human",
    "cloudflare",
    "access denied",
    "error occurred",
    "something went wrong while generating the response",
    "help.openai.com",
    "if this issue persists",
    // ChatGPT's mid-stream failure bubble — see src/ai/chatgpt.ts for why
    // this needs to be here too (same check, second line of defense).
    "error in message stream",
    // Usage/rate-limit messages from any provider (ChatGPT/Gemini/DeepSeek)
    // — same second-line-of-defense reasoning: confirmed live that
    // "You've hit your usage limit. Please try again later" got posted as
    // an actual reply to a tweet.
    "usage limit",
    "rate limit",
    "try again later",
    "you've reached your limit",
    "message limit"
  ];

  const lowerReply = trimmed.toLowerCase();
  if (errorPatterns.some(pattern => lowerReply.includes(pattern))) {
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

  const lowerReplyFirst100 = lowerReply.substring(0, 100);
  if (prohibitedAnywhere.some(phrase => lowerReplyFirst100.includes(phrase))) {
    return false;
  }

  return true;
}