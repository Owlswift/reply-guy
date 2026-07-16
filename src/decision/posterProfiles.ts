/**
 * Poster-specific overrides — per-account behavior tweaks that don't fit
 * the general scoring/urgency system in scoreTweet.ts.
 *
 * Handles listed in ALWAYS_CHATGPT_HANDLES always get an automated ChatGPT
 * reply, image or no image. They bypass the image gate entirely — no
 * SKIP_IMAGE_TWEETS auto-skip, no pause for manual review.
 */
const ALWAYS_CHATGPT_HANDLES: string[] = [
  "@EricLDaugh"
];

function normalize(handle: string): string {
  return handle.replace(/^@/, "").toLowerCase();
}

export function alwaysSendToChatGPT(handle: string): boolean {
  const normalized = normalize(handle);
  return ALWAYS_CHATGPT_HANDLES.some(h => normalize(h) === normalized);
}
