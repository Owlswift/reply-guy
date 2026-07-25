import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "repliedTweets.json");

// Maps tweet id -> the reason it was marked done. This used to be a plain
// Set<string> with no reason at all — every markReplied() call site
// (dozens of them: blocked handle, image skip, stale/saturated, "is a
// reply not an original post", review handle, thread dedup, an ACTUAL
// posted reply, etc.) called the same function regardless of what
// actually happened, so hasReplied()/"already replied" never meant "we
// posted something" — it only ever meant "we're done deciding about this,"
// and there was no way to look back and tell which of those two it was.
// That's exactly what looked like the bot silently "lying" that it had
// replied to posts it had only skipped.
let repliedCache: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (repliedCache) {
    return repliedCache;
  }

  if (!fs.existsSync(FILE)) {
    repliedCache = new Map();
    return repliedCache;
  }

  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));

  // Transparently migrate the old format (a plain array of ids, no
  // reasons) — anything recorded before this change just gets a generic
  // reason instead of losing its "already handled" status entirely.
  if (Array.isArray(data)) {
    repliedCache = new Map(data.map((id: string) => [id, "recorded before reason-tracking existed"]));
  } else {
    repliedCache = new Map(Object.entries(data));
  }

  return repliedCache;
}

function save() {
  if (repliedCache) {
    fs.writeFileSync(
      FILE,
      JSON.stringify(Object.fromEntries(repliedCache), null, 2)
    );
  }
}

export function hasReplied(id: string): boolean {
  return load().has(id);
}

/**
 * The reason this tweet was marked done, if any — e.g. "posted a reply",
 * "blocked handle", "has image(s), SKIP_IMAGE_TWEETS is on". Undefined if
 * the tweet was never marked at all.
 */
export function getRepliedReason(id: string): string | undefined {
  return load().get(id);
}

export function markReplied(id: string, reason: string = "reason not recorded (call site not yet updated)"): void {
  const ids = load();
  ids.set(id, reason);
  save();
}

// Reasons that reflect a one-off, transient failure — the AI/operator
// couldn't produce something worth posting THAT one time, not a deliberate
// "never reply to this" decision. Recording these as if they were a real
// skip decision permanently blocked a tweet from ever being retried, even
// though the actual cause was often just an AI hiccup, or the operator
// being away from the keyboard for the 20s prompt window. Structured as a
// list (not a single string) so more transient-failure reasons can be
// added later without touching every call site that checks this.
const RETRYABLE_REASONS: string[] = [
  "operator chose to skip after AI generation failed to produce a valid reply"
];

/**
 * Whether a previously-recorded "done" status should still block retrying.
 * True for every real decision (blocked handle, already posted, thread
 * dedup, etc.); false for RETRYABLE_REASONS, so a later run gets a fresh
 * shot at the AI instead of being blocked forever by one failed attempt.
 */
export function isPermanentlySkipped(id: string): boolean {
  if (!hasReplied(id)) return false;
  const reason = getRepliedReason(id);
  return reason === undefined || !RETRYABLE_REASONS.includes(reason);
}