import "dotenv/config";
import { getBrowserAndContext } from "./browser/browser";
import { scanProfileWithinWindow } from "./browser/visitProfile";
import { extractCurrentTweet } from "./browser/extractTweet";
import { ChatGPTClient } from "./ai/chatgpt";
import { judgeReplies } from "./ai/judgeReply";
import { validateReply } from "./personality/validator";
import { isDuplicate } from "./personality/duplicate";
import { markReplied, getRepliedReason, isPermanentlySkipped } from "./storage/repliedTweets";
import { isBlockedHandle, TOP_PRIORITY_HANDLES } from "./decision/scoreTweet";
import { findBlockedContentWord } from "./decision/blockedContentWords";
import { isHeavyPidgin } from "./decision/pidginDetection";
import { prepareReply, clickReply } from "./reply/reply";
import { postManualReply, hasManualReply } from "./cli/postManualReply";
import { promptReplyDecision } from "./cli/promptReplyDecision";
import { MemoryRepository } from "./database/MemoryRepository";
import { log } from "./utils/logger";

// How far back to look per handle — anything older is left alone, on the
// assumption the regular bot already had its chance at it.
const MAX_AGE_MS = 15 * 60 * 60 * 1000;

// Modest pacing between posts so a catch-up run posting several replies in
// a row doesn't look like a burst. Not the full fatigue/behavior system —
// this is a manual, occasional command, not the main loop.
const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 9000;

async function pace(): Promise<void> {
  const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  await new Promise(r => setTimeout(r, delay));
}

async function main() {
  const { context } = await getBrowserAndContext();

  // Own tabs, separate from whatever main-interactive.ts might already be
  // using — this is meant to be safe to run alongside the main bot.
  const profilePage = await context.newPage();
  const tweetPage = await context.newPage();

  const chatgpt = new ChatGPTClient();
  await chatgpt.init();
  log("[Catchup] ChatGPT client ready");

  const memoryRepo = new MemoryRepository();

  let totalReplied = 0;
  let totalSkippedAlreadyReplied = 0;
  let totalSkippedOther = 0;

  for (const handle of TOP_PRIORITY_HANDLES) {
    const cleanHandle = handle.replace(/^@/, "");

    if (isBlockedHandle(handle, handle)) {
      log(`[Catchup] @${cleanHandle} is blocked — skipping entirely.`);
      continue;
    }

    log(`[Catchup] Scanning @${cleanHandle} (last ${MAX_AGE_MS / 3_600_000}hr)...`);
    let posts;
    try {
      posts = await scanProfileWithinWindow(profilePage, handle, MAX_AGE_MS);
    } catch (err) {
      log(`[Catchup] Failed to scan @${cleanHandle}, skipping this handle: ${err}`);
      continue;
    }
    log(`[Catchup] @${cleanHandle}: ${posts.length} original post(s) in window.`);

    for (const post of posts) {
      // isPermanentlySkipped (not hasReplied) — a post marked done only
      // because the AI failed to draft anything worth posting that one
      // time (and the operator skipped it in the moment, often just
      // because they weren't at the keyboard for the 20s prompt) isn't a
      // real "never reply to this" decision. Retry it instead of treating
      // one bad ChatGPT attempt as a permanent block.
      if (isPermanentlySkipped(post.id)) {
        // This was the one skip path in this whole loop with no log line —
        // every other reason prints something, but this one just vanished
        // silently. That's exactly why a thread's ROOT can seem to
        // disappear with no trace: two segments both correctly redirect to
        // it (logged), but if the root itself was already replied to
        // earlier (by the main bot, or a previous catch-up run), it never
        // even reaches the "Opening ..." line below — it's filtered out
        // right here, before anything is printed.
        log(`[Catchup] ${post.url} already handled (${getRepliedReason(post.id) ?? "reason not recorded"}) — skipping.`);
        totalSkippedAlreadyReplied++;
        continue;
      }

      log(`[Catchup] Opening ${post.url}`);
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
        log(`[Catchup] Failed to open ${post.url}, skipping: ${err}`);
        totalSkippedOther++;
        continue;
      }

      const replyButton = tweetPage.locator('[data-testid="reply"]').first();
      if (!(await replyButton.isVisible({ timeout: 5000 }).catch(() => false))) {
        log(`[Catchup] Reply unavailable for ${post.url} — skipping.`);
        totalSkippedOther++;
        continue;
      }

      // hasReplied() above only reflects Echo's own tracking — if you
      // replied to this outside of any Echo flow (typed directly in the
      // browser, replied from your phone, etc.), Echo never recorded it.
      // Check the live thread for an existing reply from your account
      // before treating this as unanswered, same safety net the main bot
      // uses, and sync markReplied() so future runs don't ask again either.
      if (await hasManualReply(tweetPage)) {
        log(`[Catchup] Already replied to ${post.url} (found on the page, not in Echo's log) — syncing and skipping.`);
        markReplied(post.id, "already replied manually outside Echo's tracking (found on the page)");
        totalSkippedAlreadyReplied++;
        continue;
      }

      const details = await extractCurrentTweet(tweetPage);
      if (!details) {
        log(`[Catchup] Could not extract ${post.url} — skipping.`);
        totalSkippedOther++;
        continue;
      }

      // Explicit sexual content and heavy Nigerian Pidgin — same content
      // gates main-interactive.ts enforces. checked across the full text
      // plus any quoted/parent tweet, since a Pidgin-heavy QUOTED tweet
      // makes a reply just as out-of-context here as in the main bot.
      const catchupBlockedWord = findBlockedContentWord(details.fullText || details.text);
      if (catchupBlockedWord) {
        log(`[Catchup] ${post.url} contains blocked word "${catchupBlockedWord}" — skipping.`);
        markReplied(post.id, `contains blocked word "${catchupBlockedWord}"`);
        totalSkippedOther++;
        continue;
      }
      const catchupPidginContext = [
        details.fullText || details.text,
        details.quotedTweet,
        details.parentTweet
      ].filter(Boolean).join(" ");
      if (isHeavyPidgin(catchupPidginContext)) {
        log(`[Catchup] ${post.url} is heavy Nigerian Pidgin (tweet or its quoted/parent tweet) — skipping to avoid an out-of-context reply.`);
        markReplied(post.id, "heavy Nigerian Pidgin (tweet or its quoted/parent tweet), skipping to avoid an out-of-context reply");
        totalSkippedOther++;
        continue;
      }

      // Never prompt on a middle/last segment of a self-thread — same rule
      // main-interactive.ts enforces via its own thread-root redirect.
      // scanProfileWithinWindow() returns every original post in the time
      // window, continuations included, so without this check each part of
      // a multi-tweet thread gets its own "requires a decision" prompt
      // instead of only the root ever surfacing one. If the root is also
      // due for a reply, it's either already in `posts` from this same scan
      // (and gets its own iteration) or was already handled earlier.
      if (!details.isRoot && details.rootId && details.rootUrl) {
        log(`[Catchup] ${post.url} is a segment of a thread rooted at ${details.rootId} — not prompting, root handles this instead.`);
        markReplied(post.id, `segment of a thread, root is ${details.rootUrl}`);
        totalSkippedOther++;
        continue;
      }

      // Reply to someone else's tweet, not an original post — same blanket
      // rule main-interactive.ts enforces. By this point the self-thread
      // case above is already handled, so a remaining parentTweet means the
      // immediate predecessor article is a DIFFERENT author.
      if (details.parentTweet) {
        log(`[Catchup] ${post.url} is a reply to another tweet (${details.parentTweetHandle || "unknown handle"}), not an original post — skipping.`);
        markReplied(post.id, `is a reply to another tweet (${details.parentTweetHandle || "unknown handle"}), not an original post`);
        totalSkippedOther++;
        continue;
      }

      // Quotes/reposts a tweet already replied to — either someone else
      // quote-tweeting it, or (as caught live: @jas_d_barbie's "Huh" quoting
      // their own earlier "Oh well" post) the author reposting their own
      // already-answered content. A plain repost keeps the same underlying
      // id (caught by hasReplied(post.id) above); a quote-tweet is a
      // genuinely new id with no other link back to the original.
      if (details.quotedTweetId && isPermanentlySkipped(details.quotedTweetId)) {
        log(`[Catchup] ${post.url} quotes/reposts a tweet already replied to (${details.quotedTweetId}) — skipping.`);
        markReplied(post.id, `quotes/reposts a tweet already replied to (${details.quotedTweetId})`);
        totalSkippedOther++;
        continue;
      }

      const tweetText = details.fullText || details.text;

      // Every top-priority post pauses for an operator decision before any
      // reply gets drafted — answer it yourself, pass it to ChatGPT, or
      // skip — rather than only asking on image posts. Same 3-way gate
      // main-interactive.ts uses for ALWAYS_PROMPT_HANDLES.
      log(`[Catchup] ${post.url} — pausing for your decision.`);
      const decision = await promptReplyDecision(details.handle || cleanHandle, tweetText);

      if (decision === "skip" || decision === "timeout") {
        if (decision === "skip") {
          log(`[Catchup] Operator chose to skip ${post.url}.`);
        } else {
          log(`[Catchup] No response for ${post.url} — skipping.`);
        }
        totalSkippedOther++;
        continue;
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
          log(`[Catchup] Manual reply posted for ${post.url}`);
        } else {
          totalSkippedOther++;
        }
        await pace();
        continue;
      }

      log(`[Catchup] Operator chose ChatGPT for ${post.url}.`);

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
          log(`[Catchup] ChatGPT attempt ${i + 1} failed: ${err}`);
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
        log(`[Catchup] Attempt ${i + 1} not worth posting (${judged?.reason ?? "no reason"}) — regenerating.`);
        reply = "";
      }

      if (!reply && bestReply) {
        log(`[Catchup] No draft cleared the bar for ${post.url} — using best-effort fallback (score ${bestScore}).`);
        reply = bestReply;
      }

      if (!reply || !validateReply(reply)) {
        log(`[Catchup] Failed to generate a valid reply for ${post.url} — skipping.`);
        totalSkippedOther++;
        continue;
      }

      console.log(`\n🤖 Catch-up draft for @${cleanHandle}:`);
      console.log(`   ┌─ Tweet ─────────────────────────────────────`);
      console.log(`   │ ${tweetText}`);
      console.log(`   ├─ Draft ─────────────────────────────────────`);
      console.log(`   │ ${reply}`);
      console.log(`   └─────────────────────────────────────────────\n`);

      try {
        await prepareReply(tweetPage, reply);
        const success = await clickReply(tweetPage, details.handle || cleanHandle);
        if (success) {
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
              createdAt: new Date()
            });
          } catch {}
          totalReplied++;
          log(`[Catchup] Posted reply to ${post.url}`);
        } else {
          log(`[Catchup] Failed to post reply to ${post.url}`);
          totalSkippedOther++;
        }
      } catch (err) {
        log(`[Catchup] Error posting reply to ${post.url}: ${err}`);
        totalSkippedOther++;
      }

      await pace();
    }
  }

  log(
    `[Catchup] Done. Posted ${totalReplied}, ${totalSkippedAlreadyReplied} already replied, ${totalSkippedOther} skipped for other reasons.`
  );

  await tweetPage.close().catch(() => {});
  await profilePage.close().catch(() => {});
  await chatgpt.close().catch(() => {});
  process.exit(0);
}

main().catch(err => {
  console.error("[Catchup] Fatal error:", err);
  process.exit(1);
});
