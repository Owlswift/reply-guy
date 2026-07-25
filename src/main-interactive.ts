import "dotenv/config";
import { getPage, getBrowserAndContext } from "./browser/browser";
import { log, msSinceLastLog } from "./utils/logger";
import { shouldRefreshSession, markSessionRefreshed } from "./utils/session";
import { isLoggedIn } from "./browser/isLoggedIn";
import { enqueue, queueSize, getQueue, QueueItem, peek, dequeue, updateItem, reRankQueue, clearQueue } from "./core/queue";
import { pollDelay, getProfileLabel } from "./behavior/profiles";
import { NotificationFeedSource } from "./sources/NotificationFeedSource";
import { getNotificationProgress, markNotificationSeen, hasNotificationReplied } from "./storage/seenNotifications";
import { getRepliedReason, isPermanentlySkipped } from "./storage/repliedTweets";
import { hasUrlBeenReplied, markUrlReplied } from "./storage/repliedUrls";
import { scoreTweet, shouldSkipDueToAgeAndReplies, isStaleByAgeAndReplies, isTopPriority, isUrgent, isPriority, isLowPriority, isBlockedHandle, isReviewHandle, TOP_PRIORITY_HANDLES } from "./decision/scoreTweet";
import { flagPostForReview } from "./storage/flaggedPosts";
import { isBlockedQuotedTweet } from "./decision/blockedQuotedTweets";
import { isBlockedTweetId } from "./decision/blockedTweetIds";
import { findBlockedContentWord } from "./decision/blockedContentWords";
import { isHeavyPidgin } from "./decision/pidginDetection";
import { recordReplyForHour, getCurrentHourReplyCount } from "./storage/hourlyReplyStats";
import { deferLowPriorityTweet, getDeferredLowPriorityTweets, clearLowPriorityTweet } from "./storage/lowPriorityTweets";
import { runPriorityHandleWorker } from "./workers/priorityHandleWorker";
import { createNavigator, BrowserNavigator } from "./browser/BrowserNavigator";
import { extractCurrentTweet, TweetDetails } from "./browser/extractTweet";
import { markReplied } from "./storage/repliedTweets";
import { markNotificationReplied } from "./storage/seenNotifications";
import { setScrollY } from "./timeline/state";
import { stats } from "./stats/runtime";
import { ChatGPTClient } from "./ai/chatgpt";
import { GeminiClient } from "./ai/gemini";
import { DeepSeekClient } from "./ai/deepseek";
import { classifyTweet } from "./ai/classifyTweet";
import { validateReply } from "./personality/validator";
import { isDuplicate } from "./personality/duplicate";
import { judgeReplies } from "./ai/judgeReply";
import { promptWithTimeout, PROMPT_TIMEOUT_MS } from "./utils/interactivePrompt";
import chalk from "chalk";
import { startNotificationLoop } from "./utils/notify";
import { promptImageDecision, ImageDecision } from "./cli/promptImageDecision";
import { promptReplyDecision, ReplyDecision } from "./cli/promptReplyDecision";
import { promptGenerationFailedDecision, GenerationFailedDecision } from "./cli/promptGenerationFailed";
import { postManualReply, hasManualReply, ManualReplyResult } from "./cli/postManualReply";
import { alwaysSendToChatGPT, alwaysPromptBeforeReply } from "./decision/posterProfiles";
import { markSkippedForImage, wasSkippedForImage } from "./storage/skippedImageTweets";
import { markSkippedByOperator, wasSkippedByOperator } from "./storage/operatorSkippedTweets";
import {
  getReadingTime,
  getMicroBreak,
  getThinkingTime,
  getPostReplyPause,
  maybeInterruption,
  getReplyRatio,
  setSpeedMultiplier,
} from "./behavior/scheduler";

const DAILY_LIMIT = 300;

// Skip a tweet if it was posted more recently than this — the author may
// still be mid-thread. See the enqueue-loop comment below for why this
// can't just be handled by the existing thread-root redirect.
const MIN_AGE_BEFORE_REPLY_MS = 3 * 60 * 1000;

// ─── CLI flags ─────────────────────────────────────────────────────────────
// Plain numeric flags rather than env vars, so they're easy to change
// per-run: `tsx src/main-interactive.ts --speed=0.5 --scroll=4000`.
// Accepts both `--name=value` and `--name value`. Returns null if the flag
// is omitted or unparseable.
function parseNumericFlag(argv: string[], name: string): number | null {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg.startsWith(prefix)) {
      return parseFloat(arg.slice(prefix.length));
    }
    if (arg === `--${name}` && argv[i + 1]) {
      return parseFloat(argv[i + 1]!);
    }
  }
  return null;
}

// A global multiplier on every pacing delay in scheduler.ts: --speed=0.5
// halves them (faster, less human-like cover), --speed=2 doubles them
// (slower, more cover). Left at the default 1x if omitted or unparseable.
const speedFlag = parseNumericFlag(process.argv.slice(2), "speed");
if (speedFlag !== null) {
  setSpeedMultiplier(speedFlag);
  console.log(chalk.dim(`[speed] Pacing multiplier set to ${speedFlag}x`));
}

// Starting scroll position (pixels) on the notification feed, so a run can
// jump straight to wherever a previous run left off instead of always
// starting at the top and re-scanning everything above it. Applied once,
// right after the feed first loads (see main()) — also seeds
// timeline/state.ts's scrollY so goBack()/returnToTimeline()'s restore
// logic (BrowserNavigator.ts) has something real to return to if the very
// first tweet opened from this position gets skipped.
const scrollFlag = parseNumericFlag(process.argv.slice(2), "scroll");

// Same shape as parseNumericFlag, for string-valued flags like --ai=gemini.
function parseStringFlag(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${name}` && argv[i + 1]) {
      return argv[i + 1]!;
    }
  }
  return null;
}

// Which AI provider drafts replies: ChatGPT, Gemini, or DeepSeek, all driven
// the same way (a browser tab, typed prompt, scraped response — see
// ai/chatgpt.ts / ai/gemini.ts / ai/deepseek.ts). `--ai=gemini` /
// `--ai=chatgpt` / `--ai=deepseek` skips the interactive startup prompt
// entirely — required for unattended runs, since scripts/ensure-running.sh
// can launch this fully detached (nohup, no stdin at all), where an
// interactive prompt would just hang forever waiting for input that can
// never arrive.
const aiFlag = parseStringFlag(process.argv.slice(2), "ai");

// ─── Table-formatted per-tweet outcome logging ──────────────────────────────
// Every notification's fate (skipped or queued, and why) gets logged as a
// table row — URL, reason, and (when known) the thread root it was skipped
// in favor of — with a visible separator, instead of a free-form sentence.
// A fixed-width URL column keeps consecutive rows aligned into a readable
// table even though each one is still printed independently as tweets are
// processed. URL/reason/root are each given their own color so the columns
// are easy to tell apart at a glance in the terminal.
const URL_COLUMN_WIDTH = 65;
const COLOR_RESET = "\x1b[0m";
const COLOR_URL = "\x1b[36m"; // cyan
const COLOR_REASON = "\x1b[33m"; // yellow
const COLOR_ROOT = "\x1b[35m"; // magenta

function logTableHeader(): void {
  console.log(`   ${"URL".padEnd(URL_COLUMN_WIDTH)} | REASON${" ".repeat(43)} | ROOT TWEET (if part of a thread)`);
  console.log(`   ${"-".repeat(URL_COLUMN_WIDTH)}-+-${"-".repeat(50)}-+-${"-".repeat(35)}`);
}

function logTweetOutcome(status: "SKIP" | "QUEUE", url: string, reason: string, author: string, rootUrl?: string): void {
  const coloredUrl = `${COLOR_URL}${url.padEnd(URL_COLUMN_WIDTH)}${COLOR_RESET}`;
  const coloredReason = `${COLOR_REASON}${status} — ${reason} (${author})${COLOR_RESET}`;
  const rootPart = rootUrl ? ` | ${COLOR_ROOT}${rootUrl}${COLOR_RESET}` : "";
  log(`${coloredUrl} | ${coloredReason}${rootPart}`);
}

type AIProvider = "chatgpt" | "gemini" | "deepseek";

function aiProviderLabel(provider: AIProvider): string {
  if (provider === "gemini") return "Gemini";
  if (provider === "deepseek") return "DeepSeek";
  return "ChatGPT";
}

/**
 * Decide which provider to use, in priority order: the --ai flag, then an
 * interactive prompt (20s timeout, defaults to ChatGPT) if a real terminal
 * is attached, then a safe default. The timeout/default matters: without
 * it, an unattended run with no --ai flag and no TTY (scripts/ensure-
 * running.sh's detached nohup path), or one where nobody's actively
 * watching the terminal, would hang forever on a prompt nothing answers.
 */
async function resolveAiProvider(): Promise<AIProvider> {
  if (aiFlag === "chatgpt" || aiFlag === "gemini" || aiFlag === "deepseek") {
    return aiFlag;
  }
  if (aiFlag) {
    console.log(chalk.yellow(`[ai] Unrecognized --ai value "${aiFlag}" (expected "chatgpt", "gemini", or "deepseek") — ignoring it.`));
  }

  if (!process.stdin.isTTY) {
    log(`[ai] No interactive terminal attached — defaulting to ChatGPT. Pass --ai=gemini or --ai=deepseek to use a different provider in an unattended run.`);
    return "chatgpt";
  }

  // Deliberately promptWithTimeout (plain readline question + rl.close()),
  // not selectWithTimeout's arrow-key menu. selectWithTimeout's timeout
  // relies on an internal quirk (closing the live Prompt instance to force
  // early resolution) that turned out not to reliably fire for this
  // prompt — it hung indefinitely, and only the unrelated 195s watchdog
  // ever killed the process, which then restarted straight back into the
  // same unanswered prompt: an infinite restart loop that never actually
  // got the app running. readline's close() is standard, documented Node
  // behavior, not a quirk — this one MUST NOT be allowed to hang, since it
  // blocks the entire app from starting.
  const answer = await promptWithTimeout(
    `Which AI should draft replies? (chatgpt/gemini/deepseek, ${PROMPT_TIMEOUT_MS / 1000}s — defaults to chatgpt): `,
    PROMPT_TIMEOUT_MS
  );

  const normalized = answer?.trim().toLowerCase();
  if (normalized === "gemini" || normalized === "deepseek") return normalized;
  return "chatgpt";
}

// Playwright occasionally races its own internal handling of a native
// browser dialog (window.confirm/alert/beforeunload) against the dialog
// already closing — "Page.handleJavaScriptDialog: No dialog is showing" —
// and that rejection fires from an internal event listener we never
// awaited, so it can't be caught by a normal try/catch around our own
// code. Left unhandled, Node treats it as fatal and kills the whole
// process mid-reply. Log it and keep running instead — this is a rare
// library-internal race, not a sign the app's own state is corrupt.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] continuing anyway:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] continuing anyway:", err);
});

/**
 * Watchdog — Playwright calls against a hung browser tab/CDP connection can
 * sit forever without throwing, so a hang produces total silence rather than
 * an error. We treat "no log() activity for too long" as a hang signal and
 * hard-exit so an external supervisor (see scripts/watch-and-restart.sh) can
 * restart the process with a fresh CDP connection.
 */
const WATCHDOG_CHECK_INTERVAL_MS = 15_000;
const WATCHDOG_HANG_THRESHOLD_MS = 3 * 60 * 1000; // 3 min — comfortably above the ~2 min worst-case legitimate silent gap (ChatGPT generation wait)

function startWatchdog(): NodeJS.Timeout {
  const timer = setInterval(() => {
    const silence = msSinceLastLog();
    if (silence > WATCHDOG_HANG_THRESHOLD_MS) {
      console.error(
        `\n[Watchdog] No activity for ${Math.round(silence / 1000)}s — the browser/CDP connection is likely hung. Exiting so a supervisor can restart the process.\n`
      );
      process.exit(1);
    }
  }, WATCHDOG_CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

/**
 * When true, tweets with images are skipped automatically instead of
 * pausing for manual review — lets the bot run fully unattended.
 * Set SKIP_IMAGE_TWEETS=true in .env to enable.
 */
const SKIP_IMAGE_TWEETS = process.env.SKIP_IMAGE_TWEETS === "true";

/**
 * Notification-centric Echo.
 *
 * Instead of polling the home timeline and merging multiple sources, Echo
 * "stands in" the notifications inbox and waits for new post notifications
 * from the creators you've chosen to follow.
 *
 *   Notifications
 *        │
 *        ▼
 *   New post?
 *        ├── Yes → Open → Extract → Generate → Approve → Post → Back
 *        └── No  → Wait random(20–90s) → Loop
 *
 * No home timeline. No endless scrolling. No merged sources.
 * Every notification is a high-quality opportunity because it passed
 * your own follow filter.
 */

/**
 * Bookkeeping after postManualReply() resolves — shared by every "answer it
 * myself" call site below. postManualReply() itself only prompts and posts;
 * it doesn't know about the queue/notification/memory side effects, since
 * those differ by caller (this file vs. the priority-handle catch-up command).
 */
async function finalizeManualReply(
  item: QueueItem,
  details: TweetDetails,
  result: ManualReplyResult
): Promise<void> {
  if (!result.posted) {
    // The operator was offered "answer it myself" but never actually posted
    // a reply (left it blank, or didn't respond within postManualReply()'s
    // own timeout). This still has to be recorded as handled — otherwise
    // nothing marks the tweet seen, X's notification feed keeps showing it
    // unread, and the exact same tweet gets re-enqueued and re-prompted
    // every single watch cycle forever.
    markReplied(item.id, "offered a manual reply but none was posted (blank/timeout)");
    markNotificationReplied(item.id);
    return;
  }
  markReplied(item.id, "posted a manual reply");
  markNotificationReplied(item.id);
  stats.posted++;
  await recordReplyForHour().catch(() => {});
  await markUrlReplied(item.url).catch(() => {});
  try {
    const { MemoryRepository } = await import("./database/MemoryRepository");
    const memoryRepo = new MemoryRepository();
    await memoryRepo.saveMemory({
      id: "",
      tweetId: item.id,
      tweetText: details.fullText || details.text || item.text,
      authorHandle: details.handle || item.author,
      relationship: item.relationship || "stranger",
      aiDraft: "manual",
      finalReply: result.finalReply,
      wasEdited: false,
      approved: true,
      createdAt: new Date()
    });
  } catch {}
}

async function main() {
  const watchdog = startWatchdog();
  const page = await getPage();
  const navigator = createNavigator(page);

  // Dismiss native browser dialogs (window.confirm/alert/beforeunload)
  // ourselves as soon as they appear, instead of leaving it to Playwright's
  // internal default handling — that default handling is what raced against
  // a dialog closing on its own and threw an unhandled rejection that used
  // to crash the whole process.
  page.on("dialog", (dialog) => {
    dialog.dismiss().catch(() => {});
  });

  log(`Behavior profile: ${getProfileLabel()}`);

  // Initialize the chosen AI client (opens a new tab)
  const aiProvider = await resolveAiProvider();
  const chatgpt: ChatGPTClient | GeminiClient | DeepSeekClient =
    aiProvider === "gemini" ? new GeminiClient() :
    aiProvider === "deepseek" ? new DeepSeekClient() :
    new ChatGPTClient();
  await chatgpt.init();
  log(`${aiProviderLabel(aiProvider)} client ready`);

  // Priority Handles Worker — proactively checks TOP_PRIORITY_HANDLES
  // profiles for new original posts, on its own tab, independent of the
  // notification-watching loop below. Fire-and-forget: it runs forever in
  // the background and feeds the same shared queue.
  // Disabled for now — not needed at the moment.
  // {
  //   const { context } = await getBrowserAndContext();
  //   const priorityPage = await context.newPage();
  //   runPriorityHandleWorker(priorityPage, TOP_PRIORITY_HANDLES).catch(err =>
  //     log(`[PriorityHandles] worker crashed, not restarting: ${err}`)
  //   );
  //   log(`Priority Handles Worker started (${TOP_PRIORITY_HANDLES.length} handles).`);
  // }

  // The single source — notifications only
  const notificationSource = new NotificationFeedSource();

  // Navigate to notifications on startup
  log("Navigating to notifications...");
  await notificationSource.getTweets(page, navigator);

  // --scroll=<px> — jump straight to a previous run's scroll position
  // instead of always starting at the top and re-scanning everything above
  // it. Also seeds timeline/state.ts's scrollY so the very first tweet
  // opened from here restores back to this position (not 0) if skipped.
  if (scrollFlag !== null && Number.isFinite(scrollFlag) && scrollFlag > 0) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollFlag).catch(() => {});
    setScrollY(scrollFlag);
    log(`[scroll] Jumped to starting scroll position ${scrollFlag}px`);
    await page.waitForTimeout(2000);
  }

  // Tracks consecutive "no new notifications, scroll for older" cycles.
  // Five scrolls finding nothing is unusual enough that it's worth
  // double-checking we're actually still on the filtered posts feed
  // (/i/timeline) rather than silently scrolling somewhere useless —
  // e.g. a goBack()/reload() earlier left the tab on /home or stranded
  // it somewhere else entirely.
  let consecutiveEmptyScrolls = 0;
  const EMPTY_SCROLL_CHECK_THRESHOLD = 5;

  async function checkStillOnFeedAfterEmptyScrolls(): Promise<void> {
    consecutiveEmptyScrolls++;
    if (consecutiveEmptyScrolls < EMPTY_SCROLL_CHECK_THRESHOLD) return;

    if (page.url().includes("/i/timeline")) {
      consecutiveEmptyScrolls = 0;
      return;
    }

    log(`No new posts after ${consecutiveEmptyScrolls} scrolls and not on /i/timeline (currently ${page.url()}) — re-navigating via notifications.`);
    // navigateToTimeline() now reports whether it actually landed on a
    // working feed (and tries dismissing a blocking modal/overlay once if
    // the first attempt didn't land) — this used to be ignored, so a stuck
    // dialog could make every attempt silently no-op while the counter kept
    // resetting to 0 regardless, scrolling uselessly for hours between
    // checks instead of ever recovering.
    const landed = await navigator.navigateToTimeline();

    if (landed) {
      consecutiveEmptyScrolls = 0;
      return;
    }

    log(`Still not on /i/timeline after re-navigation attempt (currently ${page.url()}) — will recheck on the very next scroll instead of waiting ${EMPTY_SCROLL_CHECK_THRESHOLD} more.`);
    // Don't reset to 0 — leave it one below the threshold so the next
    // single scroll re-triggers this check immediately, retrying every
    // scroll while stuck rather than burning another full 5-scroll cycle
    // per retry.
    consecutiveEmptyScrolls = EMPTY_SCROLL_CHECK_THRESHOLD - 1;
  }

  while (stats.posted < DAILY_LIMIT) {
    // ============================================================
    // PHASE 1: WATCH NOTIFICATIONS
    // ============================================================
    log("=== PHASE: WATCH NOTIFICATIONS ===");

    try {
      // page.evaluate()/locators never throw a distinct error for "the tab
      // got closed" — isLoggedIn() swallows all errors and just returns
      // false, so without this check a crashed/closed tab is misreported
      // as "Session expired" when the real cause is the browser losing the tab.
      if (page.isClosed()) {
        log("Browser tab was closed or crashed. Stopping bot.");
        break;
      }

      // Check if still logged in
      if (!(await isLoggedIn(page))) {
        log("Session expired. Stopping bot.");
        break;
      }

      // Check if we should refresh the session
      if (shouldRefreshSession()) {
        log("Refreshing session...");
        await navigator.refreshSession();
        markSessionRefreshed();
      }

      // Fetch new post notifications
      console.log("  → Checking notifications...");
      const tweets = await notificationSource.getTweets(page, navigator);
      console.log(`  ✓ Found ${tweets.length} new post notification(s)`);

      if (tweets.length === 0) {
        // Nothing new — scroll to find older posts
        log("No new notifications. Scrolling for older posts...");
        const { scrollTimeline } = await import("./browser/scroll");
        await scrollTimeline(page);
        await page.waitForTimeout(2000);
        await checkStillOnFeedAfterEmptyScrolls();
        continue;
      }

      // Check if ALL visible tweets have already been replied to.
      // If so, scroll down to find older notifications that haven't been replied.
      const allAlreadyReplied = tweets.every(t => isPermanentlySkipped(t.id));
      if (allAlreadyReplied) {
        // Per-post visibility even on this fast path — this used to be a
        // single generic message covering the whole batch, which made it
        // impossible to tell whether these were genuinely already-replied
        // (a real reply posted) or skipped for one of the many other
        // reasons that also call markReplied() (blocked handle, image,
        // stale, etc.) without ever posting anything.
        logTableHeader();
        for (const t of tweets) {
          logTweetOutcome("SKIP", t.url, getRepliedReason(t.id) ?? "already handled, reason not recorded", t.author);
        }
        log("All visible notifications already replied. Scrolling for older posts...");
        const { scrollTimeline } = await import("./browser/scroll");
        await scrollTimeline(page);
        await page.waitForTimeout(2000);
        await checkStillOnFeedAfterEmptyScrolls();
        continue;
      }

      // Genuinely new, not-yet-replied posts to work through — reset the
      // empty-scroll counter now that real progress is happening again.
      consecutiveEmptyScrolls = 0;

      // Log each notification with score
      console.log("\n📋 New post notifications:");
      for (const t of tweets) {
        const score = scoreTweet(t);
        const skipReason = shouldSkipDueToAgeAndReplies(t) ? " ⛔ SKIP (too old/saturated)" : "";
        console.log(`   [score ${score.toString().padStart(3)}] ${t.author} — ${t.url}${skipReason}`);
      }
      console.log();

      // Enqueue notifications — apply reply ratio
      const replyRatio = getReplyRatio();
      logTableHeader();
      for (const tweet of tweets) {
        // Skip if already replied — isPermanentlySkipped, not hasReplied,
        // since a tweet only marked done because the AI failed to draft
        // anything worth posting isn't a real "never reply to this"
        // decision and deserves a fresh attempt, not a permanent block.
        if (isPermanentlySkipped(tweet.id)) {
          logTweetOutcome("SKIP", tweet.url, getRepliedReason(tweet.id) ?? "already handled, reason not recorded", tweet.author);
          continue;
        }

        // Skip if already in queue
        const existing = getQueue().find((q: QueueItem) => q.id === tweet.id);
        if (existing) {
          logTweetOutcome("SKIP", tweet.url, "already in queue", tweet.author);
          continue;
        }

        // Specific blocked tweet ids (decision/blockedTweetIds.ts) — a
        // one-off tweet to never engage with, regardless of author or content.
        if (isBlockedTweetId(tweet.id)) {
          logTweetOutcome("SKIP", tweet.url, "specifically blocked tweet id", tweet.author);
          markReplied(tweet.id, "specifically blocked tweet id");
          continue;
        }

        // Explicit sexual content (decision/blockedContentWords.ts) — never
        // engage with these regardless of author/priority.
        const blockedWord = findBlockedContentWord(tweet.text);
        if (blockedWord) {
          const wordReason = `contains blocked word "${blockedWord}"`;
          logTweetOutcome("SKIP", tweet.url, wordReason, tweet.author);
          markReplied(tweet.id, wordReason);
          continue;
        }

        // Heavy Nigerian Pidgin (decision/pidginDetection.ts) — ChatGPT
        // reliably misreads it and drafts a tonally/contextually wrong
        // reply. This only catches it when the ANCHOR tweet's own text is
        // heavily Pidgin; the more common case (a Pidgin-heavy QUOTED
        // tweet the anchor is commenting on) isn't visible until the tweet
        // is actually opened — see the PHASE 3 check after extractCurrentTweet.
        if (isHeavyPidgin(tweet.text)) {
          logTweetOutcome("SKIP", tweet.url, "heavy Nigerian Pidgin, skipping to avoid an out-of-context reply", tweet.author);
          markReplied(tweet.id, "heavy Nigerian Pidgin, skipping to avoid an out-of-context reply");
          continue;
        }

        // Any reply — to themselves (a thread continuation) or to someone
        // else entirely — is skipped outright. Only original, standalone
        // posts are eligible. Broader than the old self-reply-only check
        // (isSelfReplyContinuation, now redundant since this subsumes it):
        // a reply to another author isn't an original post either, and
        // engaging with it the same way as a fresh post reads exactly like
        // the automated, out-of-context behavior this whole thread-handling
        // rework exists to avoid.
        if (tweet.isReply) {
          const replyReason = `is a reply${tweet.replyingToHandle ? ` (to ${tweet.replyingToHandle})` : ""}, not an original post`;
          logTweetOutcome("SKIP", tweet.url, replyReason, tweet.author);
          markReplied(tweet.id, replyReason);
          continue;
        }

        // Very freshly posted — give the author a chance to finish posting
        // the rest of a thread before we commit to replying. The root-redirect
        // logic (extractTweet.ts's backward-walk, applied once a tweet is
        // opened) can only ever see segments that already exist on the page —
        // if part 2 hasn't been posted yet, part 1 looks like a complete,
        // standalone post and gets replied to like one. Not marked replied —
        // just "not yet" for this cycle; a later scan picks it back up once
        // it's old enough, and the real thread-detection logic still applies
        // then if it does turn out to have more parts.
        const ageMs = Date.now() - tweet.createdAt.getTime();
        if (ageMs < MIN_AGE_BEFORE_REPLY_MS) {
          logTweetOutcome("SKIP", tweet.url, `posted ${Math.round(ageMs / 1000)}s ago, too fresh — might still be mid-thread`, tweet.author);
          continue;
        }

        // Blocked handles (scoreTweet.ts) — never reply to these authors,
        // regardless of priority/urgent status. Takes precedence over
        // every other check below. This also covers REPOSTS of a blocked
        // author's content: for a repost, X's own DOM shows the ORIGINAL
        // author's name/handle as the article's byline (the "X reposted"
        // label is a separate line above it, not part of author/username),
        // so tweet.author/tweet.username here already reflect the original
        // (possibly blocked) author.
        if (isBlockedHandle(tweet.author, tweet.username)) {
          const blockedReason = `from blocked handle ${tweet.author}${tweet.isRepost ? " (a repost)" : ""}`;
          logTweetOutcome("SKIP", tweet.url, blockedReason, tweet.author);
          markReplied(tweet.id, blockedReason);
          continue;
        }

        // Same list, but for the REPOSTER specifically — a blocked handle
        // can also repost someone else's (non-blocked) content, and the
        // check above only ever caught a blocked ORIGINAL author, never a
        // blocked handle doing the reposting. Ignore the post either way,
        // whether the blocked handle is the author or the reposter.
        if (tweet.isRepost && tweet.reposterHandle && isBlockedHandle(tweet.reposterHandle, tweet.reposterHandle)) {
          const repostReason = `reposted by blocked handle ${tweet.reposterHandle}`;
          logTweetOutcome("SKIP", tweet.url, repostReason, tweet.author);
          markReplied(tweet.id, repostReason);
          continue;
        }

        // Review handles (scoreTweet.ts) — never auto-replied to, but
        // flagged for manual review (storage/flaggedPosts.ts) instead of
        // silently dropped like BLOCKED_HANDLES.
        if (isReviewHandle(tweet.author, tweet.username)) {
          const reviewReason = `review handle ${tweet.author}, flagged for manual review instead of replying`;
          logTweetOutcome("SKIP", tweet.url, reviewReason, tweet.author);
          await flagPostForReview(tweet.url).catch(err =>
            log(`Redis write failed flagging ${tweet.id} for review, continuing anyway: ${err}`)
          );
          markReplied(tweet.id, reviewReason);
          continue;
        }

        // Too old and/or too crowded (scoreTweet.ts) — this was previously
        // only ever used for the "⛔ SKIP" label in the log above and never
        // actually enforced, so stale/saturated posts kept getting queued
        // and replied to anyway. Enforce it here.
        if (shouldSkipDueToAgeAndReplies(tweet)) {
          logTweetOutcome("SKIP", tweet.url, "too old/saturated", tweet.author);
          markReplied(tweet.id, "too old/saturated");
          continue;
        }

        // Image tweets are detectable from the timeline card itself — skip
        // enqueueing (and thus opening) them entirely instead of paying for
        // a full open→detect→goBack cycle, mirroring the SKIP_IMAGE_TWEETS
        // gate that used to only run after the tweet was already open.
        // Top-priority handles (scoreTweet.ts) are exempt — their image
        // tweets always get opened for manual review, never skipped.
        if (
          SKIP_IMAGE_TWEETS &&
          tweet.hasImage &&
          !alwaysSendToChatGPT(tweet.username) &&
          !isTopPriority(tweet.author, tweet.username)
        ) {
          logTweetOutcome("SKIP", tweet.url, "has image(s), SKIP_IMAGE_TWEETS is on", tweet.author);
          markReplied(tweet.id, "has image(s), SKIP_IMAGE_TWEETS is on");
          continue;
        }

        // Low-priority handles (scoreTweet.ts) — don't engage yet. Park the
        // URL in Redis and revisit it later once the real queue (everyone
        // else) is completely empty, instead of competing for a queue slot now.
        if (isLowPriority(tweet.author, tweet.username)) {
          logTweetOutcome("SKIP", tweet.url, `low-priority handle ${tweet.author}, deferred for later`, tweet.author);
          markNotificationSeen(tweet.id, tweet.url);
          await deferLowPriorityTweet(tweet.url).catch(err =>
            log(`Redis write failed for low-priority ${tweet.id}, continuing anyway: ${err}`)
          );
          continue;
        }

        // Random reply-ratio throttle — skipped for urgent/top-priority
        // (isUrgent already covers isTopPriority) and plain priority
        // handles, since these should always get a reply, never a
        // random pass-through.
        const isPriorityHandle =
          isUrgent(tweet.author, tweet.username) || isPriority(tweet.author, tweet.username);
        if (!isPriorityHandle && Math.random() > replyRatio) {
          // Deliberately NOT marked replied/seen anywhere — this is a random
          // per-cycle roll, not a permanent decision, so the same tweet is
          // free to be picked up (and re-rolled) again on a later cycle.
          logTweetOutcome("SKIP", tweet.url, "random reply-ratio throttle this round, not remembered", tweet.author);
          continue;
        }

        // Mark as seen in the database
        logTweetOutcome("QUEUE", tweet.url, "enqueued", tweet.author);
        markNotificationSeen(tweet.id, tweet.url);

        const item: QueueItem = {
          id: tweet.id,
          url: tweet.url,
          author: tweet.author,
          text: tweet.text,
          createdAt: Date.now(),
          status: "pending"
        };
        enqueue(item, tweet);
      }

      // Re-rank queue (notifications age while we process others)
      reRankQueue();
      console.log(`  ✓ Queue size: ${queueSize()} (priority-ordered)`);

      // Show progress
      const progress = getNotificationProgress();
      const remaining = progress.total - progress.replied;
      console.log(`📊 Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)`);

      // If queue is empty, pull in deferred low-priority tweets before
      // scrolling for more — this is the "only reply to them once everyone
      // else is done" moment.
      if (queueSize() === 0) {
        const deferredUrls = await getDeferredLowPriorityTweets(3).catch(() => [] as string[]);

        if (deferredUrls.length > 0) {
          log(`Queue empty — pulling ${deferredUrls.length} deferred low-priority tweet(s).`);
          for (const url of deferredUrls) {
            // Claim it immediately so it isn't picked up again on the next
            // cycle, regardless of whether this attempt ends up succeeding.
            await clearLowPriorityTweet(url).catch(err =>
              log(`Redis delete failed for deferred tweet, continuing anyway: ${err}`)
            );

            const id = url.match(/status\/(\d+)/)?.[1];
            if (!id || isPermanentlySkipped(id)) {
              continue;
            }
            const author = url.match(/x\.com\/([^/]+)\/status/)?.[1];

            enqueue({
              id,
              url,
              author: author ? `@${author}` : "",
              text: "",
              createdAt: Date.now(),
              status: "pending"
            });
          }
          reRankQueue();
        } else {
          log("Queue empty. Scrolling for more posts...");
          const { scrollTimeline } = await import("./browser/scroll");
          await scrollTimeline(page);
          await page.waitForTimeout(2000);
          await checkStillOnFeedAfterEmptyScrolls();
        }
      }

    } catch (err) {
      console.error("Error watching notifications:", err);
      log("Recovering — navigating back to notifications...");
      await notificationSource.getTweets(page, navigator);
      await page.waitForTimeout(5000);
    }

    // ============================================================
    // PHASE 2: PROCESS QUEUE — reply to highest-priority first
    // ============================================================
    while (queueSize() > 0 && stats.posted < DAILY_LIMIT && !page.isClosed()) {
      const item = peek();
      if (!item) break;

      // Only process items that are "ready" or "pending"
      if (item.status === "pending") {
        updateItem(item.id, { status: "drafting" });

        try {
          // ============================================================
          // PHASE 3: OPEN NOTIFICATION TWEET (before AI generation)
          // ============================================================
          log(`=== PHASE: OPEN TWEET ${item.id} ===`);
          stats.tweets++;

          // Check if already replied BEFORE opening the tweet
          if (hasNotificationReplied(item.id)) {
            log(`Already replied to ${item.id}. Skipping.`);
            dequeue();
            continue;
          }

          // Specific blocked tweet ids (decision/blockedTweetIds.ts) — safety
          // net for anything already queued before this was added, or that
          // reached the queue through a path that skips the PHASE 1 check
          // (e.g. the low-priority deferral cache).
          if (isBlockedTweetId(item.id)) {
            log(`Tweet ${item.id} is a specifically blocked tweet id — skipping.`);
            markReplied(item.id, "specifically blocked tweet id");
            markNotificationReplied(item.id);
            dequeue();
            continue;
          }

          // Gated handles (ALWAYS_PROMPT_HANDLES in posterProfiles.ts) — if
          // the operator previously chose "skip" for this exact tweet when
          // prompted, never re-open or re-prompt it.
          // Fails open (treated as "not previously skipped") if Redis is
          // unreachable, matching the same-shaped check below.
          let previouslySkippedByOperator = false;
          if (alwaysPromptBeforeReply(item.author)) {
            try {
              previouslySkippedByOperator = await wasSkippedByOperator(item.id);
            } catch (err) {
              log(`Redis check failed for ${item.id}, proceeding anyway: ${err}`);
            }
          }
          if (previouslySkippedByOperator) {
            log(`Tweet ${item.id} previously skipped by operator — not opening.`);
            markReplied(item.id, "operator previously chose to skip this gated-handle tweet");
            dequeue();
            continue;
          }

          // Check Redis BEFORE opening the tweet — if we already know this
          // URL has image(s) and was skipped before, don't waste a navigation
          // on it again. Poster overrides and top-priority handles still get
          // opened regardless.
          // Fails open (treated as "not previously skipped") if Redis is
          // unreachable, so a Redis outage degrades to pre-Redis behavior
          // instead of every tweet erroring out and getting dropped.
          let previouslySkippedForImage = false;
          if (!alwaysSendToChatGPT(item.author) && !isTopPriority(item.author, item.author)) {
            try {
              previouslySkippedForImage = await wasSkippedForImage(item.url);
            } catch (err) {
              log(`Redis check failed for ${item.id}, proceeding anyway: ${err}`);
            }
          }
          if (previouslySkippedForImage) {
            log(`Tweet ${item.id} previously skipped for image(s) — not opening.`);
            markReplied(item.id, "previously skipped for image(s)");
            dequeue();
            continue;
          }

          // Last line of defense against replying to the same post twice,
          // checked immediately before opening it. repliedTweets.ts's
          // hasReplied() loads into memory once per process and never
          // re-reads — if two Echo processes ever ran at the same time,
          // each would have its own stale snapshot and neither could see
          // the other's replies. Redis has no such per-process caching
          // problem: every check goes to the shared server directly.
          if (await hasUrlBeenReplied(item.url).catch(() => false)) {
            log(`Tweet ${item.id} (${item.url}) was already replied to (Redis record) — not opening again.`);
            markReplied(item.id, "already replied to (Redis record) — not opening again");
            markNotificationReplied(item.id);
            dequeue();
            continue;
          }

          // Scroll position is now saved inside BrowserNavigator.openTweet()
          // itself — centralized so every caller gets it, not just this one.
          await navigator.openTweet(item.url);

          // Skip if we can't reply
          const replyButton = page.locator('[data-testid="reply"]').first();
          if (!(await replyButton.isVisible().catch(() => false))) {
            log(`Reply unavailable. Skipping.`);
            markReplied(item.id, "reply button unavailable on the tweet page");
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          const details = await extractCurrentTweet(page);
          if (!details) {
            log(`Cannot extract tweet ${item.id}. Skipping.`);
            markReplied(item.id, "could not extract tweet content from the page");
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Safety net for the enqueue-time content check above — the
          // timeline preview can be truncated, so a blocked word only
          // present once "Show more" is expanded wouldn't have been caught
          // yet. fullText is the expanded version.
          const openBlockedWord = findBlockedContentWord(details.fullText || details.text);
          if (openBlockedWord) {
            const openWordReason = `contains blocked word "${openBlockedWord}"`;
            logTweetOutcome("SKIP", item.url, openWordReason, details.handle || item.author);
            markReplied(item.id, openWordReason);
            markNotificationReplied(item.id);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Heavy Nigerian Pidgin, checked across the anchor tweet AND its
          // quoted/parent tweet — the enqueue-time check only ever sees the
          // anchor's own (often plain-English) text, so a reply that's only
          // making sense of a Pidgin-heavy QUOTED tweet slips past it. This
          // is the actual case that prompted the check: the anchor tweet
          // itself was simple English ("naija dating: invest now, watch the
          // next guy enjoy later"), but the tweet it quoted was dense Pidgin
          // ("...na 419 wey get iphone...you be the mumu wey fund the
          // upgrade"), and ChatGPT's reply made no sense in that context.
          const contextForPidginCheck = [
            details.fullText || details.text,
            details.quotedTweet,
            details.parentTweet
          ].filter(Boolean).join(" ");
          if (isHeavyPidgin(contextForPidginCheck)) {
            const pidginReason = "heavy Nigerian Pidgin (tweet or its quoted/parent tweet), skipping to avoid an out-of-context reply";
            logTweetOutcome("SKIP", item.url, pidginReason, details.handle || item.author);
            markReplied(item.id, pidginReason);
            markNotificationReplied(item.id);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Never reply to a middle/last segment of a self-thread — always
          // redirect to the root (extractTweet.ts's backward-walk found it).
          // Replying to whichever segment happened to trigger the
          // notification, instead of always the root, is exactly the "why
          // does this bot reply to every paragraph of the same story"
          // behavior that's one of the most obvious signs it's a bot.
          if (!details.isRoot && details.rootId && details.rootUrl) {
            // This segment itself is handled either way — it must never
            // surface as its own notification/queue item again.
            markReplied(item.id, `segment of a thread, redirected to root ${details.rootUrl}`);
            markNotificationReplied(item.id);

            if (isPermanentlySkipped(details.rootId)) {
              logTweetOutcome("SKIP", item.url, "segment of an already-processed thread, no navigation needed beyond this", details.handle || item.author, details.rootUrl);
              await navigator.returnToTimeline();
              dequeue();
              continue;
            }

            logTweetOutcome("SKIP", item.url, "segment of a thread, redirecting to the root instead of replying here", details.handle || item.author, details.rootUrl);
            const alreadyQueued = getQueue().find((q: QueueItem) => q.id === details.rootId);
            if (!alreadyQueued) {
              enqueue({
                id: details.rootId,
                url: details.rootUrl,
                author: details.handle || item.author,
                text: "",
                createdAt: Date.now(),
                status: "pending"
              });
              reRankQueue();
            }

            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Safety net for PHASE 1's tweet.isReply check — that one depends
          // on X reliably rendering the "Replying to" banner on the
          // notification-feed CARD, which it evidently doesn't always do
          // (confirmed live: a reply to someone else's post reached here
          // with tweet.isReply apparently false, and got its own AI reply
          // instead of being skipped). details.parentTweet is read from the
          // actual open page instead and is reliable — by this point the
          // self-thread-segment case above has already been handled, so a
          // remaining parentTweet means this tweet's immediate predecessor
          // is a DIFFERENT author: it's itself a reply to someone else, not
          // an original post. Same "only original, standalone posts are
          // eligible" rule as PHASE 1, no priority-handle exception, since
          // replying to a stranger's comment on someone else's post is the
          // exact out-of-context bot-tell that rule exists to prevent.
          if (details.parentTweet) {
            const replyToOtherReason = `is a reply to another tweet (${details.parentTweetHandle || "unknown handle"}), not an original post — PHASE 1's isReply check missed this`;
            logTweetOutcome("SKIP", item.url, replyToOtherReason, details.handle || item.author);
            markReplied(item.id, replyToOtherReason);
            markNotificationReplied(item.id);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Same idea, but for a quote/repost of a tweet already replied to
          // — either someone else quote-tweeting it, or the original author
          // reposting/quote-tweeting their own already-answered post. A
          // PLAIN repost keeps the same underlying tweet id (already caught
          // by hasReplied(item.id) above), but a quote-tweet is a genuinely
          // new tweet id with no other link back to the original — without
          // this, it reads as a brand-new post and gets its own fresh reply.
          if (details.quotedTweetId && isPermanentlySkipped(details.quotedTweetId)) {
            const repostReason = `quotes/reposts a tweet already replied to (${details.quotedTweetId})`;
            logTweetOutcome("SKIP", item.url, repostReason, details.handle || item.author);
            markReplied(item.id, repostReason);
            markNotificationReplied(item.id);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Log surrounding context as it's found — no way to verify the
          // quote-card/parent/thread DOM detection (extractTweet.ts) is
          // actually firing correctly on real tweets without seeing it.
          // details.parentTweet isn't logged here — by this point it's
          // always undefined, since the check above already skips (and
          // continues past this point) whenever it's set.
          if (details.quotedTweet) {
            log(`Tweet ${item.id} quotes: "${details.quotedTweet}"`);
          }
          if (details.previousThreadPost) {
            log(`Tweet ${item.id} continues previous post: "${details.previousThreadPost}"`);
          }

          // Quoting or replying to a blocked handle's content (scoreTweet.ts's
          // BLOCKED_HANDLES) — the current tweet isn't itself from a blocked
          // author, but surfacing/engaging with a blocked author's content
          // indirectly through a quote or a reply-to is the same thing this
          // list exists to prevent. isBlockedHandle() only ever checked the
          // CURRENT tweet's own author — quotedTweetHandle/parentTweetHandle
          // (extractTweet.ts) weren't checked against it at all until now.
          if (isBlockedHandle(details.quotedTweetHandle ?? "", details.quotedTweetHandle ?? "")) {
            log(`Tweet ${item.id} quotes blocked handle ${details.quotedTweetHandle} — skipping.`);
            markReplied(item.id, `quotes blocked handle ${details.quotedTweetHandle}`);
            markNotificationReplied(item.id);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }
          if (isBlockedHandle(details.parentTweetHandle ?? "", details.parentTweetHandle ?? "")) {
            log(`Tweet ${item.id} is a reply to blocked handle ${details.parentTweetHandle} — skipping.`);
            markReplied(item.id, `is a reply to blocked handle ${details.parentTweetHandle}`);
            markNotificationReplied(item.id);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Engagement-bait quoted tweets (decision/blockedQuotedTweets.ts) —
          // replying to whoever quoted one of these adds nothing, it's just
          // off-topic engagement farming. Skip before any further processing.
          if (isBlockedQuotedTweet(details.quotedTweet)) {
            log(`Tweet ${item.id} quotes a blocked bait tweet — skipping.`);
            markReplied(item.id, "quotes a blocked bait tweet");
            markNotificationReplied(item.id);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Re-check staleness with the real, live numbers now that the
          // tweet is actually open. The notification-stage check
          // (shouldSkipDueToAgeAndReplies, PHASE 1) only ever runs for
          // tweets discovered through the normal notification feed — a
          // tweet pulled back in from the low-priority deferral cache
          // (storage/lowPriorityTweets.ts) skips that check entirely, since
          // that cache only ever stores a bare URL with no age/reply data to
          // check against. Without this, a post that was low-priority when
          // first seen could sit deferred for hours and come back stale (old,
          // hundreds of replies deep) with nothing left to catch it before
          // it gets opened and replied to.
          const staleAgeMinutes = (Date.now() - details.latestSegmentAt) / 60_000;
          const staleHandle = details.handle || item.author;
          if (isStaleByAgeAndReplies(details.replies, staleAgeMinutes, isUrgent(staleHandle, staleHandle))) {
            log(`Tweet ${item.id} is stale (${details.replies} replies, ${Math.round(staleAgeMinutes)}m old) — skipping.`);
            markReplied(item.id, `stale (${details.replies} replies, ${Math.round(staleAgeMinutes)}m old)`);
            markNotificationReplied(item.id);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Check if @unfairleverage has already replied manually.
          if (await hasManualReply(page)) {
            log(`Already replied to ${item.id} manually. Skipping.`);
            // Mark as replied in the database to prevent future checks
            markNotificationReplied(item.id);
            markReplied(item.id, "already replied to manually (found existing reply on the page)");
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // ============================================================
          // Check if @unfairleverage is allowed to reply to this post.
          // X shows different signals for restricted replies:
          // - Reply button is greyed out / disabled
          // - "You can't reply" message is visible
          // - "You're unable to reply" toast or notice
          // - Only verified accounts / people @mentioned can reply
          // ============================================================
          const canReply = await page.evaluate(() => {
            const replyBtn = document.querySelector('[data-testid="reply"]');
            // No reply button at all — can't reply
            if (!replyBtn) return false;
            // Button has disabled attribute or aria-disabled
            if (replyBtn.hasAttribute('disabled') || replyBtn.getAttribute('aria-disabled') === 'true') return false;
            // Check for "You can't reply" text near the button or in the conversation
            const disabledTexts = document.querySelectorAll('span, div');
            for (const el of disabledTexts) {
              const text = el.textContent?.trim() || '';
              if (text.includes("can't reply") || text.includes("unable to reply") || text.includes("You can't") || text.includes("replies are limited") || text.includes("only people")) {
                return false;
              }
            }
            return true;
          }) as boolean;
          if (!canReply) {
            log(`Cannot reply to ${item.id} — replies are restricted. Skipping.`);
            markReplied(item.id, "replies are restricted on this tweet");
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // ============================================================
          // Gated-handle prompt — for handles in ALWAYS_PROMPT_HANDLES
          // (posterProfiles.ts), always pause for an operator decision
          // before any reply is drafted, overriding the image gate and the
          // ChatGPT/manual tweetType branch below. "Skip" is remembered
          // per-tweet so this exact post is never re-prompted.
          // ============================================================
          const gatedPosterHandle = details.handle || item.author;
          let operatorChoseChatGpt = false;
          if (alwaysPromptBeforeReply(gatedPosterHandle)) {
            log(`=== TWEET ${item.id} FROM ${gatedPosterHandle} — PAUSING FOR OPERATOR DECISION ===`);
            const stopNotificationLoop = startNotificationLoop();

            let decision: ReplyDecision;
            try {
              decision = await promptReplyDecision(
                gatedPosterHandle,
                details.fullText || details.text || item.text
              );
            } finally {
              stopNotificationLoop();
            }

            if (decision === "skip" || decision === "timeout") {
              if (decision === "skip") {
                log(`Operator chose to skip tweet ${item.id} from ${gatedPosterHandle} — will always skip this post.`);
                await markSkippedByOperator(item.id).catch(err =>
                  log(`Redis write failed for ${item.id}, continuing anyway: ${err}`)
                );
              } else {
                log(`No response for tweet ${item.id} from ${gatedPosterHandle} within ${PROMPT_TIMEOUT_MS / 1000}s — skipping (not remembered).`);
              }
              markReplied(item.id, decision === "skip"
                ? `operator explicitly chose to skip this gated-handle post from ${gatedPosterHandle}`
                : `no operator response within ${PROMPT_TIMEOUT_MS / 1000}s for gated-handle post from ${gatedPosterHandle}`);
              markNotificationReplied(item.id);
              await navigator.returnToTimeline();
              dequeue();
              continue;
            }

            if (decision === "myself") {
              const manualResult: ManualReplyResult = await postManualReply(page, details.handle || item.author);
              await finalizeManualReply(item, details, manualResult);
              await navigator.returnToTimeline();
              dequeue();
              continue;
            }

            log(`Operator chose ChatGPT for tweet ${item.id} from ${gatedPosterHandle}.`);
            operatorChoseChatGpt = true;
          }

          // ============================================================
          // Image gate — pause and ask before letting AI touch a tweet
          // that has an image, since images carry context an LLM can miss.
          // SKIP_IMAGE_TWEETS auto-skips any image tweet (the text-length
          // exception is commented out below).
          // Poster overrides (see posterProfiles.ts) bypass this gate
          // entirely — always straight to ChatGPT, image or no image.
          // Top-priority handles (scoreTweet.ts) take precedence over both:
          // their image tweets always pause for manual review, never
          // auto-skipped and never auto-sent to ChatGPT.
          // A gated handle whose operator already chose "chatgpt" above
          // also bypasses this gate — they already made the call, no need
          // to prompt a second time just because the tweet has an image.
          // ============================================================
          const posterHandle = details.handle || item.author;
          const hasImages = Boolean(details.imageUrls && details.imageUrls.length > 0);
          const isTopPriorityPoster = isTopPriority(posterHandle, posterHandle);
          const isOverridePoster = !isTopPriorityPoster && (alwaysSendToChatGPT(posterHandle) || operatorChoseChatGpt);

          if (hasImages && isOverridePoster) {
            log(`Tweet ${item.id} from ${posterHandle} has image(s) — poster override, sending straight to ChatGPT.`);
          }

          if (hasImages && !isOverridePoster) {
            // const tweetContext = details.fullText || details.text || item.text || "";
            if (SKIP_IMAGE_TWEETS && !isTopPriorityPoster /* && tweetContext.length <= 30 */) {
              log(`Tweet ${item.id} has image(s) — SKIP_IMAGE_TWEETS is on, skipping.`);
              await markSkippedForImage(item.url).catch(err =>
                log(`Redis write failed for ${item.id}, continuing anyway: ${err}`)
              );
              markReplied(item.id, "has image(s), SKIP_IMAGE_TWEETS is on (caught after opening)");
              await navigator.returnToTimeline();
              dequeue();
              continue;
            }

            if (isTopPriorityPoster) {
              log(`Tweet ${item.id} from ${posterHandle} has image(s) — top-priority handle, pausing for your review.`);
            }

            log(`=== TWEET ${item.id} HAS IMAGE(S) — PAUSING FOR REVIEW ===`);
            const stopNotificationLoop = startNotificationLoop();

            let decision: ImageDecision;
            try {
              decision = await promptImageDecision(
                details.handle || item.author,
                details.fullText || details.text || item.text,
                details.imageUrls.length
              );
            } finally {
              stopNotificationLoop();
            }

            if (decision === "skip") {
              log(`No response for image tweet ${item.id} within ${PROMPT_TIMEOUT_MS / 1000}s — skipping.`);
              markReplied(item.id, `no operator response to the image gate within ${PROMPT_TIMEOUT_MS / 1000}s`);
              markNotificationReplied(item.id);
              await navigator.returnToTimeline();
              dequeue();
              continue;
            }

            if (decision === "myself") {
              const manualResult: ManualReplyResult = await postManualReply(page, details.handle || item.author);
              await finalizeManualReply(item, details, manualResult);
              await navigator.returnToTimeline();
              dequeue();
              continue;
            }

            log(`Passing image tweet ${item.id} to ChatGPT for an automated reply.`);
          }

          // Reading time — scales with fatigue
          const tweetText = details.fullText || details.text || item.text;
          const readTime = getReadingTime(tweetText);
          await page.waitForTimeout(readTime);

          const { MemoryRepository } = await import("./database/MemoryRepository");
          const memoryRepo = new MemoryRepository();
          const memories = await memoryRepo.getRecentMemories(20);

          // Micro-break before drafting — scales with fatigue
          const microBreak = getMicroBreak();
          if (microBreak > 0) {
            await page.waitForTimeout(microBreak);
          }

          // Determine tweet type to decide which model to use
          const tweetType = classifyTweet(tweetText);
          
          let reply = "";
          // Greetings/well-wishes no longer get auto-generated by the local
          // model — ask for a manual reply instead, skipping this tweet
          // directly (no second prompt) if there's no response in time —
          // the operator already had their PROMPT_TIMEOUT_MS window here.
          if (tweetType === "well_wish" || tweetType === "greeting") {
            console.log(`\n${chalk.cyan(`[${tweetType}] @${item.author}`)}: "${tweetText}"`);
            reply = (await promptWithTimeout(
              chalk.cyan(`Type a reply (${PROMPT_TIMEOUT_MS / 1000}s, Enter to skip): `),
              PROMPT_TIMEOUT_MS
            )) ?? "";

            if (!reply) {
              log(`No response for ${tweetType} tweet ${item.id} within ${PROMPT_TIMEOUT_MS / 1000}s — skipping.`);
              markReplied(item.id, `no manual response for a ${tweetType} tweet within ${PROMPT_TIMEOUT_MS / 1000}s`);
              await navigator.returnToTimeline();
              dequeue();
              continue;
            }
          } else {
            // Use ChatGPT for other tweet types. Format-valid and non-duplicate
            // isn't enough on its own — judge whether the draft is actually
            // worth posting (adds insight, humor, etc., not just "I agree").
            // Regenerate within the same attempt budget if it isn't, and fall
            // back to the best-scoring attempt if none clear the bar, rather
            // than throwing away a slow ChatGPT round-trip entirely. Capped
            // at 2 attempts (was 3) — each attempt is a full ChatGPT browser
            // round-trip plus a separate local-model judgeReplies call (and
            // usually a separate analyzeTweet call before it), so a third
            // attempt was one of the largest and most variable contributors
            // to multi-minute reply times.
            let bestReply = "";
            let bestScore = -1;

            for (let i = 0; i < 2; i++) {
              try {
                reply = await chatgpt.generateReply({
                  tweet: tweetText,
                  relationship: "stranger",
                  memories,
                  context: {
                    ...(details.quotedTweet ? { quotedTweet: details.quotedTweet } : {}),
                    ...(details.parentTweet ? { parentTweet: details.parentTweet } : {}),
                    ...(details.previousThreadPost ? { previousThreadPost: details.previousThreadPost } : {}),
                  }
                });
              } catch (err) {
                log(`${aiProviderLabel(aiProvider)} attempt ${i + 1} failed: ${err}`);
                reply = "";
                continue;
              }

              if (!validateReply(reply) || isDuplicate(reply)) {
                reply = "";
                continue;
              }

              const [judged] = await judgeReplies(tweetText, [reply]);
              if (judged && judged.score > bestScore) {
                bestReply = reply;
                bestScore = judged.score;
              }

              if (judged?.worthPosting) {
                break;
              }
              log(`${aiProviderLabel(aiProvider)} attempt ${i + 1} not worth posting (${judged?.reason ?? "no reason"}) — regenerating.`);
              reply = "";
            }

            if (!reply && bestReply) {
              log(`No ${aiProviderLabel(aiProvider)} draft cleared the bar for ${item.id} — using best-effort fallback (score ${bestScore}).`);
              reply = bestReply;
            }
          }

          if (!reply || !validateReply(reply)) {
            log(`Failed to generate valid reply for ${item.id}. Pausing for your decision.`);
            const stopNotificationLoop = startNotificationLoop();

            let genFailedDecision: GenerationFailedDecision;
            try {
              genFailedDecision = await promptGenerationFailedDecision(
                details.handle || item.author,
                tweetText
              );
            } finally {
              stopNotificationLoop();
            }

            if (genFailedDecision === "myself") {
              const manualResult = await postManualReply(page, details.handle || item.author);
              await finalizeManualReply(item, details, manualResult);
            } else {
              log(`Operator chose to skip tweet ${item.id} after generation failure.`);
              markReplied(item.id, "operator chose to skip after AI generation failed to produce a valid reply");
            }

            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          updateItem(item.id, { status: "ready", draft: reply });
          stats.regenerated++;
        } catch (err) {
          console.error(`AI error for ${item.id}:`, err);
          dequeue();
          continue;
        }
      }

      // Use the same item that was just set to "ready" — don't re-peek
      // because peek() returns the highest-scored item, and another
      // higher-scored item that's still "pending" could jump ahead.
      if (item.status !== "ready") {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      updateItem(item.id, { status: "processing" });

      try {
        // Re-extract tweet details (the page is still open from the pending
        // phase). The draft was already generated and finalized in the
        // pending phase above (including the thread-completeness recheck,
        // which only matters there since that's what's actually sent to
        // ChatGPT) — this extraction is purely to re-read current text for
        // display before posting the existing item.draft. No recheck-and-wait
        // here: the draft is already decided, so waiting at this point delays
        // posting for no benefit.
        //
        // This used to also re-run getReadingTime() here — a second full
        // 15-40s "reading" pause on top of the one already paid in the
        // pending phase, timing something (reading the tweet) that had
        // already happened. Dropped it; the brief thinking-time pause below
        // is enough of a "glance before posting" beat on its own.
        const details = await extractCurrentTweet(page);
        if (!details) {
          log(`Cannot extract tweet ${item.id}. Skipping.`);
          markReplied(item.id, "could not re-extract tweet content in the posting phase");
          await navigator.returnToTimeline();
          dequeue();
          continue;
        }

        const tweetText = details.fullText || details.text || item.text;

        // Thinking time — brief pause before posting
        const thinkTime = getThinkingTime();
        if (thinkTime > 0) {
          await page.waitForTimeout(thinkTime);
        }

        // Determine tweet type
        const tweetType = classifyTweet(tweetText);
        const isAutoPost = tweetType === "well_wish";

        if (isAutoPost) {
          // ============================================================
          // PHASE 4a: AUTO-POST (well-wish)
          // ============================================================
          // item.draft was already set from the manual prompt back in the
          // "pending" phase above — no local-model call here, and nothing
          // to regenerate (an empty draft would already have been skipped
          // before the item ever reached "ready").
          const autoLabel = "well-wish";
          log(`=== AUTO-POST ${autoLabel.toUpperCase()} ===`);
          console.log(`\n🤖 Posting manual reply for ${autoLabel}: "${tweetText}"\n`);

          const { prepareReply, clickReply } = await import("./reply/reply");
          const memoryRepo = new (await import("./database/MemoryRepository")).MemoryRepository();

          const autoDraft = item.draft;
          // Tracked explicitly now — this used to call markReplied()
          // unconditionally after this block regardless of whether
          // clickReply() actually succeeded or threw, so a failed post
          // (rate limit, UI change, network hiccup) still got marked
          // "replied" with no way to tell the difference later.
          let autoPostSucceeded = false;
          if (autoDraft) {
            try {
              await prepareReply(page, autoDraft);
              const success = await clickReply(page, details.handle || item.author);
              autoPostSucceeded = success;
              if (success) {
                try {
                  await memoryRepo.saveMemory({
                    id: "",
                    tweetId: item.id,
                    tweetText,
                    authorHandle: details.handle || item.author,
                    relationship: item.relationship || "stranger",
                    aiDraft: `manual-${autoLabel}`,
                    finalReply: autoDraft,
                    wasEdited: false,
                    approved: true,
                    createdAt: new Date()
                  });
                  console.log(`🧠 Saved ${autoLabel} to memory.\n`);
                } catch {}
              }
            } catch (err) {
              console.error(`Failed to auto-post ${autoLabel}:`, err);
            }
          }

          markReplied(item.id, autoPostSucceeded
            ? `posted a ${autoLabel} reply`
            : `attempted to auto-post a ${autoLabel} reply but it did not succeed (see console for error)`);
          markNotificationReplied(item.id);
          dequeue();
          if (autoPostSucceeded) {
            stats.posted++;
            await recordReplyForHour().catch(() => {});
            await markUrlReplied(item.url).catch(() => {});
          }

          const progress = getNotificationProgress();
          const remaining = progress.total - progress.replied;
          const hourCount = await getCurrentHourReplyCount().catch(() => null);
          if (autoPostSucceeded) {
            console.log(`\n✅ ${autoLabel} reply posted. Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)${hourCount !== null ? ` — ${hourCount} this hour` : ""}\n`);
          } else {
            console.log(chalk.red(`\n❌ ${autoLabel} reply post FAILED for ${item.id} — marked handled but nothing was actually posted. Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)\n`));
          }
        } else {
          // ============================================================
          // PHASE 4b: AUTO-POST (AI draft)
          // ============================================================
          const providerLabel = aiProviderLabel(aiProvider);
          log(`=== AUTO-POST (${providerLabel}) ===`);
          console.log(`\n${chalk.green(`🤖 ${providerLabel} draft for @` + (details.handle || item.author).replace(/^@/, ""))}:\n`);
          console.log(chalk.yellow(`   ┌─ Tweet ─────────────────────────────────────`));
          console.log(chalk.yellow(`   │ ${tweetText}`));
          console.log(chalk.green(`   ├─ Draft ─────────────────────────────────────`));
          console.log(chalk.green(`   │ ${item.draft}`));
          console.log(chalk.green(`   └─────────────────────────────────────────────\n`));

          const { prepareReply, clickReply } = await import("./reply/reply");
          const memoryRepo = new (await import("./database/MemoryRepository")).MemoryRepository();

          // Tracked explicitly — see the well-wish branch above for why:
          // this used to call markReplied() unconditionally regardless of
          // whether clickReply() actually succeeded.
          let aiPostSucceeded = false;
          try {
            await prepareReply(page, item.draft!);
            const success = await clickReply(page, details.handle || item.author);
            aiPostSucceeded = success;
            if (success) {
              try {
                await memoryRepo.saveMemory({
                  id: "",
                  tweetId: item.id,
                  tweetText,
                  authorHandle: details.handle || item.author,
                  relationship: item.relationship || "stranger",
                  aiDraft: item.draft || "",
                  finalReply: item.draft || "",
                  wasEdited: false,
                  approved: true,
                  createdAt: new Date()
                });
                console.log(`🧠 Saved to memory.\n`);
              } catch {}
            }
          } catch (err) {
            console.error(`Failed to auto-post:`, err);
          }

          markReplied(item.id, aiPostSucceeded
            ? `posted a ${aiProviderLabel(aiProvider)} reply`
            : `attempted to post a ${aiProviderLabel(aiProvider)} reply but it did not succeed (see console for error)`);
          markNotificationReplied(item.id);
          dequeue();
          if (aiPostSucceeded) {
            stats.posted++;
            await recordReplyForHour().catch(() => {});
            await markUrlReplied(item.url).catch(() => {});
          }

          const progress = getNotificationProgress();
          const remaining = progress.total - progress.replied;
          const hourCount = await getCurrentHourReplyCount().catch(() => null);
          if (aiPostSucceeded) {
            console.log(`\n✅ Reply posted. Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)${hourCount !== null ? ` — ${hourCount} this hour` : ""}\n`);
          } else {
            console.log(chalk.red(`\n❌ Reply post FAILED for ${item.id} — marked handled but nothing was actually posted. Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)\n`));
          }
        }

        // ============================================================
        // PHASE 5: RETURN TO NOTIFICATIONS + pause
        // ============================================================
        log(`=== PHASE: RETURN TO NOTIFICATIONS ===`);
        // Scroll restoration now happens inside BrowserNavigator's
        // goBack()/returnToTimeline() themselves (see restoreScrollPosition
        // there) — centralized so every skip branch gets it too, not just
        // this post-reply path.
        await notificationSource.returnToPostsFeed(navigator);

        // Post-reply pause — scales with fatigue
        const postPause = getPostReplyPause();
        if (postPause > 0) {
          await page.waitForTimeout(postPause);
        }

        // Occasional interruption — scales with fatigue
        const interruption = maybeInterruption();
        if (interruption > 0) {
          log(`Interruption — ${(interruption / 1000).toFixed(0)}s pause...`);
          await page.waitForTimeout(interruption);
        }

        // Re-rank queue — other notifications may have aged
        reRankQueue();

        // Check for new notifications between each reply
        try {
          if (page.isClosed()) {
            log("Browser tab was closed or crashed. Stopping bot.");
            break;
          }
          if (!(await isLoggedIn(page))) {
            log("Session expired. Stopping bot.");
            break;
          }
          console.log("  → Checking for new notifications...");
          const freshTweets = await notificationSource.getTweets(page, navigator, true);
          if (freshTweets.length > 0) {
            const replyRatio2 = getReplyRatio();
            logTableHeader();
            for (const ft of freshTweets) {
              if (isPermanentlySkipped(ft.id)) {
                logTweetOutcome("SKIP", ft.url, getRepliedReason(ft.id) ?? "already handled, reason not recorded", ft.author);
                continue;
              }
              const existing2 = getQueue().find((q: QueueItem) => q.id === ft.id);
              if (existing2) {
                logTweetOutcome("SKIP", ft.url, "already in queue", ft.author);
                continue;
              }
              const ftBlockedWord = findBlockedContentWord(ft.text);
              if (ftBlockedWord) {
                const ftWordReason = `contains blocked word "${ftBlockedWord}"`;
                logTweetOutcome("SKIP", ft.url, ftWordReason, ft.author);
                markReplied(ft.id, ftWordReason);
                continue;
              }
              if (isHeavyPidgin(ft.text)) {
                logTweetOutcome("SKIP", ft.url, "heavy Nigerian Pidgin, skipping to avoid an out-of-context reply", ft.author);
                markReplied(ft.id, "heavy Nigerian Pidgin, skipping to avoid an out-of-context reply");
                continue;
              }
              const ftAgeMs = Date.now() - ft.createdAt.getTime();
              if (ftAgeMs < MIN_AGE_BEFORE_REPLY_MS) {
                logTweetOutcome("SKIP", ft.url, `posted ${Math.round(ftAgeMs / 1000)}s ago, too fresh — might still be mid-thread`, ft.author);
                continue;
              }
              if (
                SKIP_IMAGE_TWEETS &&
                ft.hasImage &&
                !alwaysSendToChatGPT(ft.username) &&
                !isTopPriority(ft.author, ft.username)
              ) {
                logTweetOutcome("SKIP", ft.url, "has image(s), SKIP_IMAGE_TWEETS is on", ft.author);
                markReplied(ft.id, "has image(s), SKIP_IMAGE_TWEETS is on");
                continue;
              }
              const ftIsPriorityHandle = isUrgent(ft.author, ft.username) || isPriority(ft.author, ft.username);
              if (!ftIsPriorityHandle && Math.random() > replyRatio2) {
                logTweetOutcome("SKIP", ft.url, "random reply-ratio throttle this round, not remembered", ft.author);
                continue;
              }
              logTweetOutcome("QUEUE", ft.url, "enqueued", ft.author);
              markNotificationSeen(ft.id, ft.url);
              enqueue({ id: ft.id, url: ft.url, author: ft.author, text: ft.text, createdAt: Date.now(), status: "pending" }, ft);
            }
            reRankQueue();
            console.log(`  ✓ +${freshTweets.length} new, queue: ${queueSize()}`);
          }
        } catch {
          // Non-critical — continue processing queue
        }

      } catch (err) {
        log(`Cannot reply to tweet ${item.id}. Skipping.`);
        await notificationSource.returnToPostsFeed(navigator);
        dequeue();
      }
    }
  }

  clearInterval(watchdog);
  log(`Completed ${stats.posted} replies today.`);
  await chatgpt.close();
}

main().catch(console.error);