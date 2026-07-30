import { BrowserContext } from "playwright";
import { scanProfileWithinWindow, ProfileOriginalTweet } from "../browser/visitProfile";
import { extractCurrentTweet } from "../browser/extractTweet";
import { ChatGPTClient } from "../ai/chatgpt";
import { judgeReplies } from "../ai/judgeReply";
import { validateReply } from "../personality/validator";
import { isDuplicate } from "../personality/duplicate";
import { markReplied, getRepliedReason, isPermanentlySkipped } from "../storage/repliedTweets";
import { isBlockedHandle, isTopPriority } from "../decision/scoreTweet";
import { findBlockedContentWord } from "../decision/blockedContentWords";
import { isHeavyPidgin } from "../decision/pidginDetection";
import { isQuoteBaitTweet } from "../decision/quoteBaitDetection";
import { postManualReply, hasManualReply } from "../cli/postManualReply";
import { promptReplyDecision, ReplyDecision } from "../cli/promptReplyDecision";
import { MemoryRepository } from "../database/MemoryRepository";
import { log } from "../utils/logger";
import { prepareReply, clickReply } from "../reply/reply";
// Dispatcher wiring — disconnected for now, scripts post directly/independently again.
// import { enqueueReplyJob } from "../storage/replyQueue";

// How far back to look per handle — anything older is left alone, on the
// assumption the regular bot already had its chance at it.
const DEFAULT_MAX_AGE_MS = 15 * 60 * 60 * 1000;

// Modest pacing between posts so a catch-up run posting several replies in
// a row doesn't look like a burst. Not the full fatigue/behavior system —
// this is a manual, occasional command, not the main loop.
const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 9000;

// Set SKIP_IMAGE_TWEETS=true in .env to enable — same flag main-interactive.ts
// reads, kept as a separate local constant here rather than exported since
// every other content gate in this file already duplicates its own copy of
// main-interactive.ts's rule instead of importing it.
const SKIP_IMAGE_TWEETS = process.env.SKIP_IMAGE_TWEETS === "true";

async function pace(): Promise<void> {
  const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  await new Promise(r => setTimeout(r, delay));
}

export interface SkippedPost {
  url: string;
  reason: string;
}

export interface CatchupTotals {
  totalReplied: number;
  totalSkippedAlreadyReplied: number;
  totalSkippedOther: number;
  skipped: SkippedPost[];
}

export interface RunCatchupOptions {
  // Overrides promptReplyDecision's default 20s/"timeout" behavior — e.g.
  // catchupStoryTellers.ts passes a shorter timeout defaulting straight to
  // "chatgpt" instead of skipping, since it's meant to run mostly unattended
  // through a long, auto-collected handle list.
  decisionTimeoutMs?: number;
  decisionTimeoutFallback?: ReplyDecision;
  // Called once a handle has been fully processed (whether it was blocked,
  // failed to scan, or had its posts gone through) — right before moving on
  // to the next one. Lets a caller persist "this handle is done" for its
  // own resumable-session bookkeeping without runCatchup() needing to know
  // anything about that mechanism itself.
  onHandleDone?: (handle: string) => void | Promise<void>;
}

/**
 * Run the same "visit each handle's profile, catch up on anything recent,
 * pause for an operator decision, reply" loop catchupPriorityHandles.ts
 * originally ran only over TOP_PRIORITY_HANDLES — extracted here so any
 * other handle list (e.g. catchupStoryTellers.ts's Redis-collected list)
 * can reuse the exact same content gates and reply pipeline instead of a
 * second, driftable copy of ~300 lines of logic.
 *
 * `label` prefixes every log line (e.g. "[Catchup:Priority]",
 * "[Catchup:Stories]") so interleaved runs — or shared log files — stay
 * distinguishable. `source` tags every enqueued job so
 * src/dispatcher.ts can apply the right priority tier and pacing —
 * catchup_priority (hand-curated accounts) outranks catchup_stories
 * (auto-discovered, explicitly the least time-sensitive list).
 */
export async function runCatchup(
  context: BrowserContext,
  handles: string[],
  label: string,
  source: "catchup_priority" | "catchup_stories",
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  options?: RunCatchupOptions
): Promise<CatchupTotals> {
  // Own tabs, separate from whatever main-interactive.ts might already be
  // using — this is meant to be safe to run alongside the main bot.
  const profilePage = await context.newPage();
  const tweetPage = await context.newPage();

  const chatgpt = new ChatGPTClient();
  await chatgpt.init();
  log(`${label} ChatGPT client ready`);

  const memoryRepo = new MemoryRepository();
  const priority = source === "catchup_priority" ? 3 : 4;

  let totalReplied = 0;
  let totalSkippedAlreadyReplied = 0;
  let totalSkippedOther = 0;
  const skipped: SkippedPost[] = [];

  for (const handle of handles) {
    try {
      const cleanHandle = handle.replace(/^@/, "");

      // A blank handle turns `https://x.com/${handle}` (visitProfile.ts)
      // into `https://x.com/` — the logged-in home timeline, not a
      // profile — and scanProfileWithinWindow has no way to know that, so
      // it silently treats whatever random tweet it finds there as if it
      // belonged to this "handle." Caught one of these live: a stray ""
      // entry in a handle list sent a run to a totally unrelated tweet.
      if (!cleanHandle.trim()) {
        log(`${label} Skipping a blank handle entry in the handle list.`);
        continue;
      }

      if (isBlockedHandle(handle, handle)) {
        log(`${label} @${cleanHandle} is blocked — skipping entirely.`);
        continue;
      }

      log(`${label} Scanning @${cleanHandle} (last ${maxAgeMs / 3_600_000}hr)...`);
      let postsSeen = 0;

      // Handles each original post the moment it's found during the scan
      // (see scanProfileWithinWindow's doc comment for why this replaced
      // the old collect-then-process, redirect-to-root design) — every
      // post is judged purely on its own isRoot-ness; a continuation is
      // just ignored outright rather than redirected anywhere.
      const handlePost = async (post: ProfileOriginalTweet): Promise<void> => {
        postsSeen++;

        // isPermanentlySkipped (not hasReplied) — a post marked done only
        // because the AI failed to draft anything worth posting that one
        // time (and the operator skipped it in the moment, often just
        // because they weren't at the keyboard for the 20s prompt) isn't a
        // real "never reply to this" decision. Retry it instead of treating
        // one bad ChatGPT attempt as a permanent block.
        if (isPermanentlySkipped(post.id)) {
          const reason = `already handled (${getRepliedReason(post.id) ?? "reason not recorded"})`;
          log(`${label} ${post.url} ${reason} — skipping.`);
          skipped.push({ url: post.url, reason });
          totalSkippedAlreadyReplied++;
          return;
        }

        log(`${label} Opening ${post.url}`);
        try {
          await tweetPage.goto(post.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
          // domcontentloaded fires before React renders the actual tweet UI —
          // checking the reply button right after goto() sees nothing yet and
          // reads as "unavailable" for every single tweet, not just genuinely
          // restricted ones. Wait for the article to actually mount first,
          // same as BrowserNavigator.openTweet() does for the main bot.
          await tweetPage.waitForSelector("article", { timeout: 15_000 });
          // waitForSelector only guarantees the FIRST article (the root
          // tweet) exists — replies mount ~1-1.5s later. Verified live:
          // hasManualReply() below read "false" immediately after
          // waitForSelector (only 1 article present) but "true" after this
          // wait (6 articles, including an existing reply from this
          // account) — without it, an already-replied tweet looks
          // unanswered and gets prompted again.
          await tweetPage.waitForTimeout(1800);
        } catch (err) {
          log(`${label} Failed to open ${post.url}, skipping: ${err}`);
          skipped.push({ url: post.url, reason: `failed to open the tweet page: ${err}` });
          totalSkippedOther++;
          return;
        }

        const replyButton = tweetPage.locator('[data-testid="reply"]').first();
        if (!(await replyButton.isVisible({ timeout: 5000 }).catch(() => false))) {
          log(`${label} Reply unavailable for ${post.url} — skipping.`);
          skipped.push({ url: post.url, reason: "reply button unavailable on the tweet page" });
          totalSkippedOther++;
          return;
        }

        // hasReplied() above only reflects Echo's own tracking — if you
        // replied to this outside of any Echo flow (typed directly in the
        // browser, replied from your phone, etc.), Echo never recorded it.
        // Check the live thread for an existing reply from your account
        // before treating this as unanswered, same safety net the main bot
        // uses, and sync markReplied() so future runs don't ask again either.
        if (await hasManualReply(tweetPage)) {
          const reason = "already replied manually outside Echo's tracking (found on the page)";
          log(`${label} Already replied to ${post.url} (found on the page, not in Echo's log) — syncing and skipping.`);
          markReplied(post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedAlreadyReplied++;
          return;
        }

        const details = await extractCurrentTweet(tweetPage);
        if (!details) {
          log(`${label} Could not extract ${post.url} — skipping.`);
          skipped.push({ url: post.url, reason: "could not extract tweet content from the page" });
          totalSkippedOther++;
          return;
        }

        // Never reply to a middle/last segment of a self-thread — same rule
        // main-interactive.ts enforces. Previously this redirected to the
        // thread's root instead of just ignoring the segment, on the
        // assumption the root would either already be in this same scan or
        // had already been handled earlier — that assumption broke when a
        // thread's root fell just outside maxAgeMs while a later
        // continuation (posted when the author came back to add more)
        // stayed inside it: the root was never scanned at all, so every
        // continuation's redirect pointed at a tweet that would never be
        // opened, and the thread silently never got a reply. Simply
        // ignoring a non-root segment is correct either way — if its root
        // genuinely is within the window, it gets its own turn when the
        // scan reaches it (isRoot true), with no redirect needed.
        if (!details.isRoot) {
          log(`${label} ${post.url} is a segment of a thread (root is ${details.rootUrl ?? "unknown, older than the window"}) — not its own root, ignoring.`);
          return;
        }

        // Explicit sexual content and heavy Nigerian Pidgin — same content
        // gates main-interactive.ts enforces. checked across the full text
        // plus any quoted/parent tweet, since a Pidgin-heavy QUOTED tweet
        // makes a reply just as out-of-context here as in the main bot.
        const catchupBlockedWord = findBlockedContentWord(details.fullText || details.text);
        if (catchupBlockedWord) {
          const reason = `contains blocked word "${catchupBlockedWord}"`;
          log(`${label} ${post.url} ${reason} — skipping.`);
          markReplied(post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }
        const catchupPidginContext = [
          details.fullText || details.text,
          details.quotedTweet,
          details.parentTweet
        ].filter(Boolean).join(" ");
        if (isHeavyPidgin(catchupPidginContext)) {
          const reason = "heavy Nigerian Pidgin (tweet or its quoted/parent tweet), skipping to avoid an out-of-context reply";
          log(`${label} ${post.url} is heavy Nigerian Pidgin (tweet or its quoted/parent tweet) — skipping to avoid an out-of-context reply.`);
          markReplied(post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }
        if (isQuoteBaitTweet(details.fullText || details.text)) {
          const reason = "quote-tweet engagement bait";
          log(`${label} ${post.url} is quote-tweet engagement bait — skipping.`);
          markReplied(post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }

        // Reply to someone else's tweet, not an original post — same blanket
        // rule main-interactive.ts enforces. By this point the self-thread
        // case above is already handled, so a remaining parentTweet means the
        // immediate predecessor article is a DIFFERENT author.
        if (details.parentTweet) {
          const reason = `is a reply to another tweet (${details.parentTweetHandle || "unknown handle"}), not an original post`;
          log(`${label} ${post.url} is a reply to another tweet (${details.parentTweetHandle || "unknown handle"}), not an original post — skipping.`);
          markReplied(post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }

        // Quotes/reposts a tweet already replied to — either someone else
        // quote-tweeting it, or the author reposting their own
        // already-answered content. A plain repost keeps the same underlying
        // id (caught by hasReplied(post.id) above); a quote-tweet is a
        // genuinely new id with no other link back to the original.
        if (details.quotedTweetId && isPermanentlySkipped(details.quotedTweetId)) {
          const reason = `quotes/reposts a tweet already replied to (${details.quotedTweetId})`;
          log(`${label} ${post.url} quotes/reposts a tweet already replied to (${details.quotedTweetId}) — skipping.`);
          markReplied(post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }

        const tweetText = details.fullText || details.text;

        // Image posts carry context an LLM can miss, so they're a manual-
        // review-only gate — skipped outright unless this is a top-priority
        // handle (decision/scoreTweet.ts), where images still fall through
        // to the same decision prompt below (respond, or let it time out
        // and skip). Mirrors the SKIP_IMAGE_TWEETS gate main-interactive.ts
        // enforces for its own discovery/posting flow.
        const hasImages = Boolean(details.imageUrls && details.imageUrls.length > 0);
        const isTopHandle = isTopPriority(details.handle || cleanHandle, details.handle || cleanHandle);
        if (SKIP_IMAGE_TWEETS && hasImages && !isTopHandle) {
          const reason = "has image(s), not a top-priority handle, SKIP_IMAGE_TWEETS is on";
          log(`${label} ${post.url} ${reason} — skipping.`);
          markReplied(post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }

        // Every other post pauses for an operator decision before any reply
        // gets drafted — answer it yourself, pass it to ChatGPT, or skip.
        // Same 3-way gate main-interactive.ts uses for ALWAYS_PROMPT_HANDLES;
        // image posts from top-priority handles reach this same prompt
        // instead of being auto-skipped above.
        log(`${label} ${post.url} — pausing for your decision.`);
        const decision = await promptReplyDecision(details.handle || cleanHandle, tweetText, {
          timeoutMs: options?.decisionTimeoutMs,
          timeoutFallback: options?.decisionTimeoutFallback,
        });

        if (decision === "skip" || decision === "timeout") {
          const reason = decision === "skip" ? "operator chose to skip" : "no response to the decision prompt within the timeout";
          if (decision === "skip") {
            log(`${label} Operator chose to skip ${post.url}.`);
          } else {
            log(`${label} No response for ${post.url} — skipping.`);
          }
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }

        if (decision === "myself") {
          const manualResult = await postManualReply(tweetPage, details.handle || cleanHandle);
          if (manualResult.posted) {
            markReplied(post.id, "posted a manual reply via catch-up");
            try {
              await memoryRepo.saveMemory({
                id: "",
                tweetId: post.id,
                tweetText,
                authorHandle: details.handle || cleanHandle,
                relationship: "stranger",
                aiDraft: "manual",
                finalReply: manualResult.finalReply,
                wasEdited: false,
                approved: true,
                createdAt: new Date()
              });
            } catch {}
            totalReplied++;
            log(`${label} Manual reply posted for ${post.url}`);
          } else {
            const reason = "manual reply not posted (declined, or postManualReply failed — see log above)";
            log(`${label} ${post.url} — ${reason}.`);
            skipped.push({ url: post.url, reason });
            totalSkippedOther++;
          }
          await pace();
          return;
        }

        log(`${label} Operator chose ChatGPT for ${post.url}.`);

        const memories = await memoryRepo.getRecentMemories(20);

        let reply = "";
        let bestReply = "";
        let bestScore = -1;

        for (let i = 0; i < 3; i++) {
          try {
            reply = await chatgpt.generateReply({
              tweet: tweetText,
              relationship: "stranger",
              memories
            });
          } catch (err) {
            log(`${label} ChatGPT attempt ${i + 1} failed: ${err}`);
            reply = "";
            continue;
          }

          if (!validateReply(reply) || isDuplicate(reply)) {
            reply = "";
            continue;
          }

          const [judged] = await judgeReplies(tweetText, [reply]);
          // valid check is load-bearing here — an invalid reply (error
          // message, refusal, etc.) always scores 0, which is still > the
          // initial bestScore of -1, so without this it could win the
          // best-effort fallback below and get posted anyway.
          if (judged && judged.valid && judged.score > bestScore) {
            bestReply = reply;
            bestScore = judged.score;
          }

          if (judged?.worthPosting) {
            break;
          }
          if (judged && !judged.valid) {
            log(`${label} Attempt ${i + 1} was invalid (${judged.reason || "no reason"}) — regenerating.`);
            reply = "";
            continue;
          }
          log(`${label} Attempt ${i + 1} not worth posting (${judged?.reason ?? "no reason"}) — regenerating.`);
          reply = "";
        }

        if (!reply && bestReply) {
          log(`${label} No draft cleared the bar for ${post.url} — using best-effort fallback (score ${bestScore}).`);
          reply = bestReply;
        }

        if (!reply || !validateReply(reply)) {
          log(`${label} Failed to generate a valid reply for ${post.url} — skipping.`);
          skipped.push({ url: post.url, reason: "no ChatGPT draft cleared the validity/quality bar after 3 attempts" });
          totalSkippedOther++;
          return;
        }

        console.log(`\n📥 Catch-up draft for @${cleanHandle}:`);
        console.log(`   ┌─ Tweet ─────────────────────────────────────`);
        console.log(`   │ ${tweetText}`);
        console.log(`   ├─ Draft ─────────────────────────────────────`);
        console.log(`   │ ${reply}`);
        console.log(`   └─────────────────────────────────────────────\n`);

        // Dispatcher disconnected for now — posts directly again instead of
        // enqueueing. See the commented-out queued version below to
        // re-enable src/dispatcher.ts routing.
        await prepareReply(tweetPage, reply, post.id);
        const posted = await clickReply(tweetPage, details.handle || cleanHandle);
        if (posted) {
          markReplied(post.id, "posted a ChatGPT-drafted reply via catch-up");
          try {
            await memoryRepo.saveMemory({
              id: "",
              tweetId: post.id,
              tweetText,
              authorHandle: details.handle || cleanHandle,
              relationship: "stranger",
              aiDraft: reply,
              finalReply: reply,
              wasEdited: false,
              approved: true,
              createdAt: new Date(),
            });
          } catch {}
          totalReplied++;
          log(`${label} Posted reply to ${post.url}`);
        } else {
          const reason = "clickReply did not confirm the post went through";
          log(`${label} Failed to post reply to ${post.url}: ${reason}`);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
        }
        await pace();

        // === DISPATCHER-QUEUED VERSION (disconnected for now) ===
        // try {
        //   await enqueueReplyJob({
        //     source,
        //     priority,
        //     tweetUrl: post.url,
        //     tweetId: post.id,
        //     authorHandle: details.handle || cleanHandle,
        //     replyText: reply,
        //     onPosted: {
        //       type: "catchup",
        //       tweetId: post.id,
        //       reason: "posted a ChatGPT-drafted reply via catch-up",
        //       memory: {
        //         tweetId: post.id,
        //         tweetText,
        //         authorHandle: details.handle || cleanHandle,
        //         relationship: "stranger",
        //         aiDraft: reply,
        //         finalReply: reply,
        //       },
        //     },
        //   });
        //   totalReplied++;
        //   log(`${label} Queued reply to ${post.url}`);
        // } catch (err) {
        //   log(`${label} Failed to queue reply to ${post.url}: ${err}`);
        //   skipped.push({ url: post.url, reason: `failed to queue the reply: ${err}` });
        //   totalSkippedOther++;
        // }
      };

      try {
        await scanProfileWithinWindow(profilePage, handle, maxAgeMs, handlePost);
      } catch (err) {
        log(`${label} Failed to scan @${cleanHandle}, skipping this handle: ${err}`);
        continue;
      }
      log(`${label} @${cleanHandle}: done, saw ${postsSeen} original post(s) in window.`);
    } finally {
      // Fires regardless of which path this handle took (blocked, scan
      // failure, or a full pass over its posts) — lets a caller (e.g.
      // catchupStoryTellers.ts's resumable session) persist "this handle is
      // done" so an interrupted run can pick up where it left off instead
      // of restarting from the beginning of the handle list.
      await options?.onHandleDone?.(handle);
    }
  }

  log(
    `${label} Done. Posted ${totalReplied}, ${totalSkippedAlreadyReplied} already replied, ${totalSkippedOther} skipped for other reasons.`
  );
  if (skipped.length > 0) {
    log(`${label} Skipped posts and why:`);
    for (const s of skipped) {
      log(`${label}   - ${s.url} — ${s.reason}`);
    }
  }

  await tweetPage.close().catch(() => {});
  await profilePage.close().catch(() => {});
  await chatgpt.close().catch(() => {});

  return { totalReplied, totalSkippedAlreadyReplied, totalSkippedOther, skipped };
}
