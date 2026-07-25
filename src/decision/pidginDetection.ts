/**
 * Nigerian Pidgin markers — words that essentially never appear in
 * standard English, so a whole-word match is a reliable signal rather than
 * a coincidental substring hit.
 *
 * ChatGPT reliably misreads dense Pidgin — it drafts a reply that's
 * grammatically fine but tonally/contextually wrong, and the judge model
 * doesn't reliably catch that either (both failures happened on the same
 * tweet: "naija dating na 419 wey get iphone... you be the mumu wey fund
 * the upgrade" got a flat, out-of-place "at what point do you think people
 * should start noticing they're carrying the whole thing alone?"). Rather
 * than trying to fix comprehension, skip entirely when there's enough
 * Pidgin present that a misread is likely.
 *
 * A single marker isn't enough to flag on its own — plenty of otherwise
 * standard-English tweets use one Pidgin word as flavor ("abeg", "sha")
 * without the rest of the tweet needing Pidgin fluency to understand.
 * Require several distinct hits before treating it as too risky to draft
 * a reply for.
 */
const PIDGIN_MARKERS: string[] = [
  "wey", "dey", "abeg", "wetin", "abi", "sabi", "waka", "wahala",
  "japa", "kolo", "gbege", "shey", "mumu", "sef", "omo", "biko", "oyinbo"
];

const MIN_MARKERS_FOR_SKIP = 3;

function countPidginMarkers(text: string): number {
  let count = 0;
  for (const word of PIDGIN_MARKERS) {
    const matches = text.match(new RegExp(`\\b${word}\\b`, "gi"));
    if (matches) count += matches.length;
  }
  return count;
}

export function isHeavyPidgin(text: string): boolean {
  return countPidginMarkers(text) >= MIN_MARKERS_FOR_SKIP;
}
