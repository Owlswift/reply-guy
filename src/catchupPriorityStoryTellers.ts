import "dotenv/config";
import { getBrowserAndContext } from "./browser/browser";
import { PRIORITY_STORY_TELLER_HANDLES } from "./decision/scoreTweet";
import {
  getOrStartSession,
  markSessionHandleDone,
  clearSession,
} from "./storage/priorityStoryCatchupSession";
import { runCatchup } from "./catchup/runCatchup";
import { log } from "./utils/logger";
import { playNotificationSound } from "./utils/notify";

// Same workflow as catchupStoryTellers.ts (resumable shuffled session, same
// decision-prompt shape, same content gates via runCatchup.ts) but always
// scoped to just PRIORITY_STORY_TELLER_HANDLES (decision/scoreTweet.ts) —
// a dedicated, on-demand way to give priority handles a pass whenever you
// want, independent of catchupStoryTellers.ts's own normal/priority_only
// alternation (which only lands on the priority list every OTHER
// completed run there).
//
// Passes source: "catchup_stories" to runCatchup() (not a new source type)
// — these ARE story-teller handles, so they should share the same 1-3/hr
// global quota, the same "1 reply per handle then move on" behavior, and
// the same daily per-handle log (storage/dailyStoryTellerReplyStats.ts,
// wired universally into reply/reply.ts's clickReply()) as every other
// story-teller reply, not a separate budget of their own.
const DECISION_TIMEOUT_MS = 10_000;

async function main() {
  const allHandles = PRIORITY_STORY_TELLER_HANDLES.map((h) => h.replace(/^@/, "").toLowerCase());

  if (allHandles.length === 0) {
    log("[Catchup:PriorityStories] No priority story-teller handles configured — nothing to do.");
    process.exit(0);
  }

  const handles = await getOrStartSession(allHandles);
  if (handles.length < allHandles.length) {
    log(`[Catchup:PriorityStories] Resuming a previous session — ${handles.length}/${allHandles.length} handle(s) remaining.`);
  } else {
    log(`[Catchup:PriorityStories] Starting a fresh session — ${handles.length} handle(s), shuffled.`);
  }

  const { context } = await getBrowserAndContext();
  await runCatchup(context, handles, "[Catchup:PriorityStories]", "catchup_stories", undefined, {
    decisionTimeoutMs: DECISION_TIMEOUT_MS,
    decisionTimeoutFallback: "chatgpt",
    onHandleDone: (handle) => markSessionHandleDone(handle),
  });

  // Only reached if the run made it through every handle without being
  // killed — an interrupted run leaves its session behind for next time.
  await clearSession();
  log("[Catchup:PriorityStories] Session complete.");
  playNotificationSound();
  process.exit(0);
}

main().catch((err) => {
  console.error("[Catchup:PriorityStories] Fatal error:", err);
  process.exit(1);
});
