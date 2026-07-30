import "dotenv/config";
import { getBrowserAndContext } from "./browser/browser";
import { getStoryTellerHandles } from "./storage/storyTellerHandles";
import { getOrStartSession, markSessionHandleDone, clearSession } from "./storage/storyCatchupSession";
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

  // Resumable, shuffled session (storage/storyCatchupSession.ts) — if a
  // previous run got interrupted partway through, this picks up with
  // whatever handles are still left instead of restarting from the front
  // of the list every time. Only once every handle in the session has been
  // processed does the session get cleared, so the NEXT fresh run reshuffles.
  const handles = await getOrStartSession(allHandles);
  if (handles.length < allHandles.length) {
    log(`[Catchup:Stories] Resuming a previous session — ${handles.length}/${allHandles.length} handle(s) remaining.`);
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
  // killed — an interrupted run leaves its session behind for next time.
  await clearSession();
  log("[Catchup:Stories] Session complete.");
  playNotificationSound();
  process.exit(0);
}

main().catch(err => {
  console.error("[Catchup:Stories] Fatal error:", err);
  process.exit(1);
});
