/**
 * Patterns that indicate an AI provider (ChatGPT/Gemini/DeepSeek) returned a
 * UI status/error message instead of an actual reply — mid-stream failures,
 * dropped connections, rate/usage limits, auth/consent walls, etc.
 *
 * Single shared source of truth instead of four separately-maintained
 * copies (one per provider client, plus validator.ts's second line of
 * defense). That duplication is exactly how "Connection interrupted.
 * Waiting for the complete answer." slipped through and got posted as a
 * real reply — a phrase discovered in one provider used to only get
 * patched wherever someone happened to be looking, leaving the other
 * three still vulnerable to the exact same failure. Now every consumer
 * reads from here, so one addition covers all of them at once.
 */
export const AI_ERROR_PATTERNS: string[] = [
  // Bot-detection / consent walls
  "enable javascript",
  "enable cookies",
  "challenge-error",
  "verify you are human",
  "cloudflare",
  "access denied",
  // Generic failure pages
  "error occurred",
  "something went wrong",
  "if this issue persists",
  "help.openai.com",
  "help.google.com",
  "server is busy",
  "network error",
  "i'm having trouble",
  // Mid-stream / dropped-connection failures — includes ChatGPT's "Error in
  // message streamRetry" bubble (scraped via textContent with no space
  // between the message and the Retry button label) and the "Connection
  // interrupted. Waiting for the complete answer." case that prompted
  // consolidating this list in the first place.
  "error in message stream",
  "connection interrupted",
  "connection lost",
  "waiting for the complete answer",
  "waiting for a response",
  "response was interrupted",
  "generation was interrupted",
  "reconnecting",
  "please refresh the page",
  // Usage/rate limits
  "usage limit",
  "rate limit",
  "try again later",
  "you've reached your limit",
  "message limit",
];

export function isLikelyAiErrorMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return AI_ERROR_PATTERNS.some(pattern => lower.includes(pattern));
}
