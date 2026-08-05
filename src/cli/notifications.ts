import "dotenv/config";
import { Page } from "playwright";
import { getBrowserAndContext } from "../browser/browser";
import { ChatGPTClient } from "../ai/chatgpt";
import { MemoryRepository } from "../database/MemoryRepository";
import { scanRecentReplyNotifications } from "../notifications/scanNotifications";
import {
  getPendingReplyNotifications,
  clearPendingReplyNotification,
} from "../storage/replyNotificationQueue";
import {
  extractReplyPermalinkContext,
  ThreadData,
  ExtractedReply,
} from "../engage/extractThreadReplies";
import { classifyReply } from "../engage/classifyReply";
import {
  shouldSkipReply,
  shouldEndConversation,
  shouldLikeOnly,
  likeAndMoveOn,
  postClosingReaction,
  handleReply,
  pace,
} from "../engage/processReply";
import {
  addReplyNode,
  hasRepliedToReply,
  hasRepliedToReplyAnywhere,
  getOrCreateConversation,
} from "../engage/threadConversationTracker";
import { log } from "../utils/logger";

const ECHO_HANDLE = "@unfairleverage";
const NOTIFICATIONS_URL = "https://x.com/notifications";
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

async function main() {
  console.log("");
  console.log("  ╔═══════════════════════════════════════════╗");
  console.log("  ║     Echo Notifications — Reply Scan        ║");
  console.log("  ╚═══════════════════════════════════════════╝");
  console.log("");

  const { context } = await getBrowserAndContext();

  const chatgpt = new ChatGPTClient();
  await chatgpt.init();
  log("[Notifications] ChatGPT client ready");

  const memoryRepo = new MemoryRepository();

  let scanPage: Page | null = null;
  let candidates = await getPendingReplyNotifications();

  if (candidates.length > 0) {
    console.log(`📋 ${candidates.length} pending reply notification(s) left over from a previous run — resuming without a fresh scan.\n`);
  } else {
    scanPage = await context.newPage();
    console.log("📬 Opening notifications...");
    await scanPage.goto(NOTIFICATIONS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    try {
      await scanPage.waitForSelector("article", { timeout: 15000 });
    } catch {
      console.error("❌ No notifications loaded — aborting.");
      await scanPage.close().catch(() => {});
      await chatgpt.close().catch(() => {});
      process.exit(1);
    }

    const cutoff = Date.now() - LOOKBACK_MS;
    console.log(`🔎 Scanning for replies to ${ECHO_HANDLE} from the last 24h...`);
    candidates = await scanRecentReplyNotifications(scanPage, ECHO_HANDLE, cutoff);
    console.log(`Found ${candidates.length} candidate reply notification(s) within the last 24h.\n`);
  }

  let considered = 0;
  let repliesPosted = 0;
  let likesGiven = 0;
  let conversationsEnded = 0;

  for (let idx = 0; idx < candidates.length; idx++) {
    const candidate = candidates[idx]!;
    try {
      // Cheap dedup before spending a tab-open: has Echo already replied to
      // this exact reply id in any past session, regardless of which post it
      // turns out to belong to?
      if (hasRepliedToReplyAnywhere(candidate.id)) {
        console.log(`⏭ Skipping ${candidate.username}: already replied to this reply`);
        continue;
      }

      considered++;
      console.log(`\n--- Notification ${considered}/${candidates.length}: ${candidate.username} ---`);

      // Open this notification's own permalink in a dedicated tab and read
      // the verified context there — same approach engage.ts uses per reply.
      // X's "Replying to @X" line (which qualified this as a candidate) can
      // name multiple participants, not just the immediate parent, so this
      // confirms the tweet directly above it in the ancestor chain really is
      // one of Echo's own posts/replies before doing anything else with it.
      const notifPage = await context.newPage();
      let verified: Awaited<ReturnType<typeof extractReplyPermalinkContext>> = null;
      try {
        await notifPage.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await notifPage.waitForSelector("article", { timeout: 10000 });
        await new Promise((r) => setTimeout(r, 1800));
        verified = await extractReplyPermalinkContext(notifPage, candidate.id, candidate.username, ECHO_HANDLE);
      } catch (err) {
        log(`[Notifications] Failed to open ${candidate.url}: ${err}`);
      }

      const normalizedEcho = ECHO_HANDLE.replace(/^@/, "").toLowerCase();
      const parentIsEcho =
        !!verified?.hasParent &&
        verified.parentAuthor.replace(/^@/, "").toLowerCase() === normalizedEcho;

      if (!verified || !parentIsEcho || !verified.parentId) {
        console.log("  ⏭ Not a direct reply to one of your posts/replies — skipping.");
        await notifPage.close().catch(() => {});
        continue;
      }

      const rootTweetId = verified.parentId;

      if (hasRepliedToReply(rootTweetId, candidate.id)) {
        console.log(`  ⏭ Skipping ${candidate.username}: already replied to this reply`);
        await notifPage.close().catch(() => {});
        continue;
      }

      // hasRepliedToReply/hasRepliedToReplyAnywhere above only reflect
      // Echo's own recorded activity — a reply posted manually outside any
      // Echo flow (typed directly in the browser, from your phone, via a
      // different command) never gets recorded there, so this comment would
      // otherwise look unanswered forever. verified.alreadyRepliedByMe
      // checks specifically the articles AFTER this comment's own position
      // on its permalink page (extractReplyPermalinkContext) — real replies
      // TO it, not the "Replying to @unfairleverage" line every candidate
      // here has by definition (that previously made hasManualReply(), a
      // check built for a different page layout, a false positive on
      // essentially every genuine reply).
      if (verified.alreadyRepliedByMe) {
        console.log(`  ⏭ Skipping ${candidate.username}: already replied (found on the page, not in Echo's log) — syncing.`);
        addReplyNode(rootTweetId, {
          replyId: `echo-${Date.now()}`,
          authorHandle: ECHO_HANDLE,
          text: "(already replied outside Echo's tracking, found on the page)",
          parentReplyId: candidate.id,
          depth: 1,
          createdAt: Date.now(),
          isByMe: true,
        });
        await notifPage.close().catch(() => {});
        continue;
      }

      getOrCreateConversation(rootTweetId, [ECHO_HANDLE]);

      const threadData: ThreadData = {
        rootTweetId,
        rootTweetUrl: `https://x.com/${ECHO_HANDLE.replace(/^@/, "")}/status/${rootTweetId}`,
        rootTweetAuthor: ECHO_HANDLE,
        rootTweetHandle: ECHO_HANDLE,
        rootTweetText: verified.parentText,
        replies: [],
      };

      const reply: ExtractedReply = {
        id: candidate.id,
        authorHandle: candidate.username,
        authorName: candidate.author.replace(/@\w+/, "").trim() || candidate.username.replace(/^@/, ""),
        text: verified.replyText || candidate.text,
        createdAt: candidate.createdAt.getTime(),
        isByMe: false,
        parentReplyId: null,
        depth: 0,
      };

      console.log(`  🔍 Classifying reply from ${reply.authorHandle}: "${reply.text.substring(0, 60)}..."`);
      const classification = await classifyReply(reply.text, threadData.rootTweetText);
      console.log(`    Class: ${classification.replyClass} | Decision: ${classification.engagementDecision} | Reason: ${classification.reason}`);

      if (shouldSkipReply(classification)) {
        console.log(`  ⏭ Ignoring ${reply.authorHandle}: ${classification.reason}`);
        await notifPage.close().catch(() => {});
        continue;
      }

      // Record their reply in the tree — done for every processed reply
      // (not just ones we go on to answer) so future scans recognize it.
      addReplyNode(rootTweetId, {
        replyId: reply.id,
        authorHandle: reply.authorHandle,
        text: reply.text,
        parentReplyId: reply.parentReplyId,
        depth: reply.depth,
        createdAt: reply.createdAt,
        isByMe: reply.isByMe,
      });

      // LIKE_ONLY (conversation closers like "fr"/"exactly"/"yes", praise,
      // thanks, well-wishes) → like the reply and move on. No response back —
      // these are conversation terminators; posting anything reads as a bot.
      // END_CONVERSATION (simple agreement) still gets a short closing
      // reaction.
      if (shouldLikeOnly(classification)) {
        console.log(`  ❤️ Liking ${reply.authorHandle}'s reply (${classification.replyClass}) — no response needed`);
        const liked = await likeAndMoveOn({
          browserContext: context,
          reply,
          page: notifPage,
        });
        if (liked) likesGiven++;
        await notifPage.close().catch(() => {});
        await pace();
        continue;
      }

      if (shouldEndConversation(classification)) {
        console.log(`  🏁 Ending conversation with ${reply.authorHandle}`);
        const posted = await postClosingReaction({
          browserContext: context,
          threadData,
          reply,
          echoHandle: ECHO_HANDLE,
          replyClass: classification.replyClass,
          page: notifPage,
        });
        if (posted) repliesPosted++;
        conversationsEnded++;
        await pace();
        continue;
      }

      if (classification.engagementDecision !== "REPLY" && classification.engagementDecision !== "REPLY_AND_LIKE") {
        await notifPage.close().catch(() => {});
        continue;
      }

      const outcome = await handleReply({
        browserContext: context,
        chatgpt,
        memoryRepo,
        threadData,
        reply,
        echoHandle: ECHO_HANDLE,
        page: notifPage,
      });

      if (outcome.posted) repliesPosted++;
      // Dispatcher disconnected for now — pace directly between replies again.
      // The "myself" manual path inside handleReply() already paces itself
      // right after posting, so this is only reached for the ChatGPT path.
      if (outcome.tookChatGptPath) await pace();
    } finally {
      // Whatever happened above — replied, liked, ended, skipped, or ruled
      // out as not a real reply — this candidate has been fully handled, so
      // it comes off the pending queue. It stays in the permanent "seen" set
      // (replyNotificationQueue.ts) regardless, so a future scan never
      // rediscovers it.
      await clearPendingReplyNotification(candidate.id);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("  NOTIFICATIONS SESSION COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Candidates handled:           ${candidates.length}`);
  console.log(`  Considered:                  ${considered}`);
  console.log(`  Replies posted:              ${repliesPosted}`);
  console.log(`  Likes given:                 ${likesGiven}`);
  console.log(`  Conversations ended:         ${conversationsEnded}`);
  console.log("=".repeat(60) + "\n");

  await scanPage?.close().catch(() => {});
  await chatgpt.close().catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error("[Notifications] Fatal error:", err);
  process.exit(1);
});
