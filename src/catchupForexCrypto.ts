import "dotenv/config";
import { getBrowserAndContext } from "./browser/browser";
import { getForexCryptoHandles } from "./storage/forexCryptoHandles";
import { getOrStartSession, markSessionHandleDone, clearSession } from "./storage/forexCryptoCatchupSession";
import { runCatchup } from "./catchup/runCatchup";
import { log } from "./utils/logger";
import { playNotificationSound } from "./utils/notify";

// Unlike catchupPriorityHandles.ts (a fixed, hand-maintained list), this
// list is collected automatically as the main bot encounters tweets about
// forex and/or crypto (main-interactive.ts, storage/forexCryptoHandles.ts)
// — it can grow unbounded over time, so this is a manual, occasional
// command to run through whatever's accumulated so far, not something
// scheduled to run automatically.
//
// Meant to run mostly unattended through what can be a long handle list, so
// the operator-decision prompt gets a shorter timeout (10s) that defaults
// straight to "chatgpt" instead of skipping — see runCatchup.ts's
// decisionTimeoutMs/decisionTimeoutFallback options.
const DECISION_TIMEOUT_MS = 10_000;

async function main() {
  const allHandles = await getForexCryptoHandles();

  if (allHandles.length === 0) {
    log("[Catchup:ForexCrypto] No forex/crypto handles recorded yet — nothing to do.");
    process.exit(0);
  }

  // Resumable, shuffled session (storage/forexCryptoCatchupSession.ts) — if
  // a previous run got interrupted partway through, this picks up with
  // whatever handles are still left instead of restarting from the front
  // of the list every time. Only once every handle in the session has been
  // processed does the session get cleared, so the NEXT fresh run reshuffles.
  const handles = await getOrStartSession(allHandles);
  if (handles.length < allHandles.length) {
    log(`[Catchup:ForexCrypto] Resuming a previous session — ${handles.length}/${allHandles.length} handle(s) remaining.`);
  } else {
    log(`[Catchup:ForexCrypto] Starting a fresh session — ${handles.length} handle(s), shuffled.`);
  }

  const { context } = await getBrowserAndContext();
  await runCatchup(context, handles, "[Catchup:ForexCrypto]", "catchup_forex_crypto", undefined, {
    decisionTimeoutMs: DECISION_TIMEOUT_MS,
    decisionTimeoutFallback: "chatgpt",
    onHandleDone: (handle) => markSessionHandleDone(handle),
  });

  // Only reached if the run made it through every handle without being
  // killed — an interrupted run leaves its session behind for next time.
  await clearSession();
  log("[Catchup:ForexCrypto] Session complete.");
  playNotificationSound();
  process.exit(0);
}

main().catch(err => {
  console.error("[Catchup:ForexCrypto] Fatal error:", err);
  process.exit(1);
});