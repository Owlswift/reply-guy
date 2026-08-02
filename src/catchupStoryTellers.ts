import "dotenv/config";
import { getBrowserAndContext } from "./browser/browser";
import { getStoryTellerHandles } from "./storage/storyTellerHandles";
import {
  getOrStartSession,
  markSessionHandleDone,
  clearSession,
  setLastCatchupStoriesMode,
} from "./storage/storyCatchupSession";
import { isPriorityStoryTeller } from "./decision/scoreTweet";
import { runCatchup } from "./catchup/runCatchup";
import { log } from "./utils/logger";
import { playNotificationSound } from "./utils/notify";

// Unlike catchupPriorityHandles.ts (a fixed, hand-maintained list), this
// list is collected automatically as the main bot encounters threaded
// posts (main-interactive.ts, storage/storyTellerHandles.ts) — it can grow
// unbounded over time, so this is a manual, occasional command to run
// through whatever's accumulated so far, not something scheduled to run
// automatically.
//
// Meant to run mostly unattended through what can be a long handle list, so
// the operator-decision prompt gets a shorter timeout (10s) that defaults
// straight to "chatgpt" instead of skipping — see runCatchup.ts's
// decisionTimeoutMs/decisionTimeoutFallback options.
const DECISION_TIMEOUT_MS = 10_000;

async function main() {
  const allHandles = await getStoryTellerHandles();

  if (allHandles.length === 0) {
    log("[Catchup:Stories] No story-teller handles recorded yet — nothing to do.");
    process.exit(0);
  }

  // Alternate between a normal session (every handle, 1 reply each) and a
  // session dedicated solely to PRIORITY_STORY_TELLER_HANDLES
  // (decision/scoreTweet.ts) — priority handles get a whole extra pass
  // every other run instead of 2 replies stacked back-to-back in one
  // sitting, which read as scripted. Falls back to "normal" if there are
  // no priority handles in the list yet. Resuming an interrupted session
  // reuses whatever mode THAT session actually started under (tracked by
  // storyCatchupSession.ts itself) rather than recomputing one here — a
  // leftover session's real contents must always match the mode it's
  // reported as running.
  const priorityHandles = allHandles.filter((h) => isPriorityStoryTeller(h, h));
  const { handles, mode, resumed } = await getOrStartSession(allHandles, priorityHandles);

  if (mode === "priority_only") {
    log(`[Catchup:Stories] Priority-only session — ${priorityHandles.length} handle(s).`);
  }
  if (resumed) {
    log(`[Catchup:Stories] Resuming a previous session — ${handles.length} handle(s) remaining.`);
  } else {
    log(`[Catchup:Stories] Starting a fresh session — ${handles.length} handle(s), shuffled.`);
  }

  const { context } = await getBrowserAndContext();
  await runCatchup(context, handles, "[Catchup:Stories]", "catchup_stories", undefined, {
    decisionTimeoutMs: DECISION_TIMEOUT_MS,
    decisionTimeoutFallback: "chatgpt",
    onHandleDone: (handle) => markSessionHandleDone(handle),
  });

  // Only reached if the run made it through every handle without being
  // killed — an interrupted run leaves its session behind for next time,
  // resuming in the same mode it was already running (see
  // storyCatchupSession.ts's SESSION_MODE_KEY).
  await clearSession();
  await setLastCatchupStoriesMode(mode);
  log("[Catchup:Stories] Session complete.");
  playNotificationSound();
  process.exit(0);
}

main().catch(err => {
  console.error("[Catchup:Stories] Fatal error:", err);
  process.exit(1);
});
