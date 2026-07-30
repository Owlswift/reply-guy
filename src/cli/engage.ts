import "dotenv/config";
import { getBrowserAndContext } from "../browser/browser";
import { ChatGPTClient } from "../ai/chatgpt";
import { extractThreadReplies } from "../engage/extractThreadReplies";
import { classifyReply } from "../engage/classifyReply";
import { MemoryRepository } from "../database/MemoryRepository";
import { log } from "../utils/logger";
import {
  addReplyNode,
  hasRepliedToReply,
  getOrCreateConversation,
} from "../engage/threadConversationTracker";
import { hasReachedMaxReplies } from "../engage/rateLimiter";
import {
  shouldSkipReply,
  shouldEndConversation,
  postClosingReaction,
  handleReply,
  pace,
} from "../engage/processReply";

async function main() {
  const args = process.argv.slice(2);
  const tweetUrl = args[0];

  if (!tweetUrl) {
    console.error("Usage: pnpm engage <tweet_url>");
    console.error("Example: pnpm engage https://x.com/unfairleverage/status/198373738373");
    process.exit(1);
  }

  if (!tweetUrl.includes("x.com") && !tweetUrl.includes("twitter.com")) {
    console.error("Error: Invalid tweet URL. Must be an x.com or twitter.com URL.");
    process.exit(1);
  }

  const statusMatch = tweetUrl.match(/status\/(\d+)/);
  if (!statusMatch) {
    console.error("Error: Invalid tweet URL. Could not find status ID.");
    process.exit(1);
  }

  const maxRepliesFlag = args.find((a) => a.startsWith("--max="));
  const maxReplies = maxRepliesFlag ? parseInt(maxRepliesFlag.split("=")[1] ?? "20", 10) : 20;

  const echoHandle = "@unfairleverage";

  console.log("");
  console.log("  ╔═══════════════════════════════════════════╗");
  console.log("  ║        Echo Engage — Inbound Mode         ║");
  console.log("  ╚═══════════════════════════════════════════╝");
  console.log("");
  console.log(`  Tweet: ${tweetUrl}`);
  console.log(`  Max replies: ${maxReplies}`);
  console.log("");

  // Open own browser tab — separate from the main bot
  const { context } = await getBrowserAndContext();

  // Tab for scanning the thread. Each reply gets its own fresh tab,
  // opened right before responding to it and closed right after.
  const scanPage = await context.newPage();

  const chatgpt = new ChatGPTClient();
  await chatgpt.init();
  log("[Engage] ChatGPT client ready");

  const memoryRepo = new MemoryRepository();

  // Step 1: Open tweet and extract thread using the scan tab
  console.log(`📱 Opening tweet: ${tweetUrl}`);
  const threadData = await extractThreadReplies(scanPage, tweetUrl);

  if (!threadData) {
    console.error("❌ Could not extract thread data");
    await scanPage.close().catch(() => {});
    await chatgpt.close().catch(() => {});
    process.exit(1);
  }

  console.log(`\n📊 Thread: ${threadData.rootTweetHandle}: "${threadData.rootTweetText.substring(0, 80)}..."`);
  console.log(`   Replies found: ${threadData.replies.length}\n`);

  getOrCreateConversation(threadData.rootTweetId, [threadData.rootTweetHandle]);

  const repliesToProcess = threadData.replies.filter((r) => !r.isByMe);

  let repliesPosted = 0;
  let likesGiven = 0;
  let conversationsEnded = 0;
  let considered = 0;

  for (const reply of repliesToProcess) {
    if (hasReachedMaxReplies(considered)) {
      console.log(`\n🛑 Reached max replies (${maxReplies}) for this session`);
      break;
    }

    considered++;
    console.log(`\n--- Reply ${considered}/${repliesToProcess.length} ---`);

    // Per-reply dedup only — has Echo already replied to this specific
    // comment? (Not a thread-wide gate: replying to one commenter must not
    // block engaging with every other, unrelated commenter on the same post.)
    if (hasRepliedToReply(threadData.rootTweetId, reply.id)) {
      console.log(`  ⏭ Skipping ${reply.authorHandle}: already replied to this reply`);
      continue;
    }

    // Classify the reply
    console.log(`  🔍 Classifying reply from ${reply.authorHandle}: "${reply.text.substring(0, 60)}..."`);
    const classification = await classifyReply(reply.text, threadData.rootTweetText);
    console.log(`    Class: ${classification.replyClass} | Decision: ${classification.engagementDecision} | Reason: ${classification.reason}`);

    if (shouldSkipReply(classification)) {
      console.log(`  ⏭ Ignoring ${reply.authorHandle}: ${classification.reason}`);
      continue;
    }

    // Record their reply in the tree — done for every processed reply
    // (not just ones we go on to answer) so future scans can tell we've
    // already seen it, including the END_CONVERSATION case below.
    addReplyNode(threadData.rootTweetId, {
      replyId: reply.id,
      authorHandle: reply.authorHandle,
      text: reply.text,
      parentReplyId: reply.parentReplyId,
      depth: reply.depth,
      createdAt: reply.createdAt,
      isByMe: reply.isByMe,
    });

    // Both END_CONVERSATION (simple agreement — "facts", "this") and
    // LIKE_ONLY (praise, well-wishes, thanks, etc.) get the same short
    // closing reaction rather than a full generated reply — LIKE_ONLY used
    // to trigger no actual action at all beyond a log line, which reads as
    // ignoring the person no matter what kind of positive comment it was.
    if (shouldEndConversation(classification) || classification.engagementDecision === "LIKE_ONLY") {
      const isLikeOnly = classification.engagementDecision === "LIKE_ONLY";
      console.log(
        isLikeOnly
          ? `  ❤️ Reacting to ${reply.authorHandle}'s reply (LIKE_ONLY)`
          : `  🏁 Ending conversation with ${reply.authorHandle}`
      );
      const posted = await postClosingReaction({
        browserContext: context,
        threadData,
        reply,
        echoHandle,
      });
      if (isLikeOnly) {
        likesGiven++;
      } else {
        conversationsEnded++;
      }
      if (posted) {
        repliesPosted++;
      }
      await pace();
      continue;
    }

    if (classification.engagementDecision !== "REPLY" && classification.engagementDecision !== "REPLY_AND_LIKE") {
      continue;
    }

    const outcome = await handleReply({
      browserContext: context,
      chatgpt,
      memoryRepo,
      threadData,
      reply,
      echoHandle,
    });

    if (outcome.posted) {
      repliesPosted++;
    }
    // Dispatcher disconnected for now — pace directly between replies again.
    // The "myself" manual path inside handleReply() already paces itself
    // right after posting, so this is only reached for the ChatGPT path.
    if (outcome.tookChatGptPath) await pace();
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("  ENGAGE SESSION COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Total replies considered: ${considered}`);
  console.log(`  Replies posted:           ${repliesPosted}`);
  console.log(`  Likes given:              ${likesGiven}`);
  console.log(`  Conversations ended:      ${conversationsEnded}`);
  console.log("=".repeat(60) + "\n");

  // Clean up own resources
  await scanPage.close().catch(() => {});
  await chatgpt.close().catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error("[Engage] Fatal error:", err);
  process.exit(1);
});
