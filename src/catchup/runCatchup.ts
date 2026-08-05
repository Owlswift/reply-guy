import { BrowserContext } from "playwright";
import { scanProfileWithinWindow, ProfileOriginalTweet } from "../browser/visitProfile";
import { extractCurrentTweet } from "../browser/extractTweet";
import { ChatGPTClient } from "../ai/chatgpt";
import { judgeReplies } from "../ai/judgeReply";
import { validateReply } from "../personality/validator";
import { isDuplicate } from "../personality/duplicate";
import { markReplied, getRepliedReason, isPermanentlySkipped } from "../storage/repliedTweets";
import {
  markForexCryptoTweetHandled,
  getForexCryptoHandledReason,
  isForexCryptoTweetHandled,
} from "../storage/forexCryptoTweetHandled";
import { isBlockedHandle, isTopPriority } from "../decision/scoreTweet";
import { findBlockedContentWord } from "../decision/blockedContentWords";
import { isHeavyPidgin } from "../decision/pidginDetection";
import { isQuoteBaitTweet } from "../decision/quoteBaitDetection";
import { postManualReply, hasManualReply } from "../cli/postManualReply";
import { promptReplyDecision, ReplyDecision } from "../cli/promptReplyDecision";
import { MemoryRepository } from "../database/MemoryRepository";
import { log } from "../utils/logger";
import { prepareReply, clickReply } from "../reply/reply";
import { openReplyBox } from "../reply/openReplyBox";
import { waitForReplyTurn, recordQuotaReply } from "../storage/hourlyReplyQuota";
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

export type CatchupSource = "catchup_priority" | "catchup_stories" | "catchup_forex_crypto";

// Routes "is this tweet already handled" / "mark it handled" to the right
// backing store for the source: catchup_forex_crypto uses its own 24h-TTL'd
// Redis record (storage/forexCryptoTweetHandled.ts), everything else stays
// on repliedTweets.ts's permanent local-file record.
async function isAlreadyHandled(
  source: CatchupSource,
  id: string
): Promise<{ handled: boolean; reason: string | undefined }> {
  if (source === "catchup_forex_crypto") {
    const [handled, reason] = await Promise.all([
      isForexCryptoTweetHandled(id),
      getForexCryptoHandledReason(id),
    ]);
    return { handled, reason };
  }
  return { handled: isPermanentlySkipped(id), reason: getRepliedReason(id) };
}

async function recordHandled(source: CatchupSource, id: string, reason: string): Promise<void> {
  if (source === "catchup_forex_crypto") {
    await markForexCryptoTweetHandled(id, reason);
    return;
  }
  markReplied(id, reason);
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
  source: CatchupSource,
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
      // catchup_stories only: once this handle has gotten one reply, stop
      // scanning its remaining posts in the window and move to the next
      // handle — spreads the shared hourly budget across more distinct
      // handles instead of one handle's whole backlog. Applies uniformly,
      // including PRIORITY_STORY_TELLER_HANDLES (decision/scoreTweet.ts) —
      // two replies to the same handle in one sitting reads as scripted;
      // those handles instead get a whole session (catchupStoryTellers.ts)
      // dedicated to just them every other run. Incremented only on an
      // actual successful post, not on a skip/decline, so the scan can
      // still try a different post from the same handle if a candidate was
      // gated or declined for an unrelated reason.
      let repliesThisHandle = 0;
      const maxRepliesThisHandle = 1;

      // Handles each original post the moment it's found during the scan
      // (see scanProfileWithinWindow's doc comment for why this replaced
      // the old collect-then-process, redirect-to-root design) — every
      // post is judged purely on its own isRoot-ness; a continuation is
      // just ignored outright rather than redirected anywhere.
      const handlePost = async (post: ProfileOriginalTweet): Promise<void | true> => {
        // Global hourly reply budget (storage/hourlyReplyQuota.ts) —
        // pauses this whole run until the next hour once this hour's
        // shared 1-3 target is reached (by this script or any other),
        // and paces between individual replies otherwise so the budget
        // spreads across the hour instead of firing back-to-back —
        // before spending any resources on this post. catchup_forex_crypto
        // opts out entirely, same as notifications.ts/engage.ts — it never
        // waits for a turn and its posts don't count against the budget.
        if (source !== "catchup_forex_crypto") {
          await waitForReplyTurn(label);
        }

        postsSeen++;

        // isPermanentlySkipped (not hasReplied) — a post marked done only
        // because the AI failed to draft anything worth posting that one
        // time (and the operator skipped it in the moment, often just
        // because they weren't at the keyboard for the 20s prompt) isn't a
        // real "never reply to this" decision. Retry it instead of treating
        // one bad ChatGPT attempt as a permanent block.
        const handledCheck = await isAlreadyHandled(source, post.id);
        if (handledCheck.handled) {
          const reason = `already handled (${handledCheck.reason ?? "reason not recorded"})`;
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

        // Real eligibility probe — the button-visible check above only
        // catches "no reply button at all," not X's own restriction
        // messages (e.g. "You aren't allowed to reply to this Tweet"),
        // which still render a clickable-looking button. Same fix
        // main-interactive.ts already applies: actually open the composer
        // and immediately close it with nothing typed, cheap enough to do
        // before spending extraction + a ChatGPT round-trip on a post that
        // can never actually be posted to.
        try {
          await openReplyBox(tweetPage, post.id);
          await tweetPage.keyboard.press("Escape");
          await tweetPage.waitForTimeout(300);
        } catch (err) {
          const reason = `reply composer would not open (restricted or otherwise unavailable): ${err}`;
          log(`${label} ${post.url} — reply composer would not open, skipping before extraction.`);
          await recordHandled(source, post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }

        // hasReplied() above only reflects Echo's own tracking — if you
        // replied to this outside of any Echo flow (typed directly in the
        // browser, replied from your phone, etc.), Echo never recorded it.
        // Check the live thread for an existing reply from your account
        // before treating this as unanswered, same safety net the main bot
        // uses, and sync recordHandled() so future runs don't ask again either.
        if (await hasManualReply(tweetPage)) {
          const reason = "already replied manually outside Echo's tracking (found on the page)";
          log(`${label} Already replied to ${post.url} (found on the page, not in Echo's log) — syncing and skipping.`);
          await recordHandled(source, post.id, reason);
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
          await recordHandled(source, post.id, reason);
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
          await recordHandled(source, post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }
        if (isQuoteBaitTweet(details.fullText || details.text)) {
          const reason = "quote-tweet engagement bait";
          log(`${label} ${post.url} is quote-tweet engagement bait — skipping.`);
          await recordHandled(source, post.id, reason);
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
          await recordHandled(source, post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }

        // Quotes/reposts a tweet already replied to — either someone else
        // quote-tweeting it, or the author reposting their own
        // already-answered content. A plain repost keeps the same underlying
        // id (caught by hasReplied(post.id) above); a quote-tweet is a
        // genuinely new id with no other link back to the original.
        if (details.quotedTweetId && (await isAlreadyHandled(source, details.quotedTweetId)).handled) {
          const reason = `quotes/reposts a tweet already replied to (${details.quotedTweetId})`;
          log(`${label} ${post.url} quotes/reposts a tweet already replied to (${details.quotedTweetId}) — skipping.`);
          await recordHandled(source, post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }

        const tweetText = details.fullText || details.text;

        // Story-teller handles specifically (catchup:stories and
        // catchup:priority-stories both pass source: "catchup_stories") —
        // a short post from one of these accounts isn't the actual
        // narrative content this list exists for, it's a stray one-liner
        // that doesn't carry enough to reflect on. Checked against the
        // full extracted text, same as every other content gate here, not
        // the timeline-preview text start:search's 120-char filter uses.
        if (source === "catchup_stories" && tweetText.length < 200) {
          const reason = `too short for a story reply (${tweetText.length} chars, need 200+)`;
          log(`${label} ${post.url} ${reason} — skipping.`);
          await recordHandled(source, post.id, reason);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
          return;
        }

        // Media posts (image, video, or GIF) carry context an LLM can
        // miss, so they're a manual-review-only gate — skipped outright
        // unless this is a top-priority handle (decision/scoreTweet.ts),
        // where media still falls through to the same decision prompt
        // below (respond, or let it time out and skip). Mirrors the
        // SKIP_IMAGE_TWEETS gate main-interactive.ts enforces for its own
        // discovery/posting flow.
        //
        // catchup_forex_crypto is exempt from the auto-skip entirely —
        // chart/trade screenshots are exactly the substance of what these
        // accounts post, so silently skipping their image posts would miss
        // most of the actual content. Media from this source always falls
        // through to the decision prompt below, regardless of
        // SKIP_IMAGE_TWEETS or top-priority status.
        const hasMedia = Boolean((details.imageUrls && details.imageUrls.length > 0) || details.hasVideo);
        const isTopHandle = isTopPriority(details.handle || cleanHandle, details.handle || cleanHandle);
        if (SKIP_IMAGE_TWEETS && hasMedia && !isTopHandle && source !== "catchup_forex_crypto") {
          const reason = "has media, not a top-priority handle, SKIP_IMAGE_TWEETS is on";
          log(`${label} ${post.url} ${reason} — skipping.`);
          await recordHandled(source, post.id, reason);
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
            // A deliberate "always skip this post" — persist it so it never
            // comes back up. Previously this only pushed to the in-memory
            // `skipped` summary for this run and returned, so nothing was
            // actually recorded anywhere; the very next run (or a resumed
            // one after Ctrl+C) had no memory of the choice and asked again.
            // Timeout is left unrecorded on purpose — that's the operator
            // not being at the keyboard, not a real decision, so it should
            // get asked again next time they actually are.
            await recordHandled(source, post.id, reason);
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
            await recordHandled(source, post.id, "posted a manual reply via catch-up");
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
            repliesThisHandle++;
            if (source !== "catchup_forex_crypto") {
              await recordQuotaReply();
            }
            log(`${label} Manual reply posted for ${post.url}`);
          } else {
            const reason = "manual reply not posted (declined, or postManualReply failed — see log above)";
            log(`${label} ${post.url} — ${reason}.`);
            skipped.push({ url: post.url, reason });
            totalSkippedOther++;
          }
          await pace();
          if (source === "catchup_stories" && repliesThisHandle >= maxRepliesThisHandle) return true;
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
          await recordHandled(source, post.id, "posted a ChatGPT-drafted reply via catch-up");
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
          repliesThisHandle++;
          if (source !== "catchup_forex_crypto") {
            await recordQuotaReply();
          }
          log(`${label} Posted reply to ${post.url}`);
        } else {
          const reason = "clickReply did not confirm the post went through";
          log(`${label} Failed to post reply to ${post.url}: ${reason}`);
          skipped.push({ url: post.url, reason });
          totalSkippedOther++;
        }
        await pace();
        if (source === "catchup_stories" && repliesThisHandle >= maxRepliesThisHandle) return true;

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
