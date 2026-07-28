import "dotenv/config";
import { getBrowserAndContext } from "../browser/browser";
import { ChatGPTClient } from "../ai/chatgpt";
import { extractThreadReplies } from "../engage/extractThreadReplies";
import { classifyReply } from "../engage/classifyReply";
import { genAIEngagePrompt } from "../engage/engagePrompt";
import { judgeReplies } from "../ai/judgeReply";
import { validateReply } from "../personality/validator";
import { isDuplicate } from "../personality/duplicate";
import { MemoryRepository } from "../database/MemoryRepository";
import { prepareReply, clickReply } from "../reply/reply";
import { postManualReply } from "../cli/postManualReply";
import { promptReplyDecision } from "../cli/promptReplyDecision";
import { log } from "../utils/logger";
import {
  getOrCreateConversation,
  addReplyNode,
  hasRepliedToReply,
  buildConversationContext,
} from "../engage/threadConversationTracker";
import { getNextWaitTime, hasReachedMaxReplies, formatWaitTime } from "../engage/rateLimiter";
import { ReplyClassification, ReplyClass } from "../engage/types";

const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 9000;

async function pace(): Promise<void> {
  const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  await new Promise(r => setTimeout(r, delay));
}

function shouldSkipReply(classification: ReplyClassification): boolean {
  const skipClasses: ReplyClass[] = ["SPAM", "BOT", "EMOJI_ONLY", "TAGGING_FRIEND"];
  if (skipClasses.includes(classification.replyClass)) return true;
  if (classification.engagementDecision === "IGNORE") return true;
  return false;
}

function shouldEndConversation(classification: ReplyClassification): boolean {
  return classification.engagementDecision === "END_CONVERSATION";
}

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
    const classification = await classifyReply(reply.text);
    console.log(`    Class: ${classification.replyClass} | Decision: ${classification.engagementDecision} | Reason: ${classification.reason}`);

    if (shouldSkipReply(classification)) {
      console.log(`  ⏭ Ignoring ${reply.authorHandle}: ${classification.reason}`);
      continue;
    }

    if (shouldEndConversation(classification)) {
      console.log(`  🏁 Ending conversation with ${reply.authorHandle}`);
      conversationsEnded++;
      continue;
    }

    // Record their reply in the tree
    addReplyNode(threadData.rootTweetId, {
      replyId: reply.id,
      authorHandle: reply.authorHandle,
      text: reply.text,
      parentReplyId: reply.parentReplyId,
      depth: reply.depth,
      createdAt: reply.createdAt,
      isByMe: reply.isByMe,
    });

    if (classification.engagementDecision === "LIKE_ONLY") {
      console.log(`  ❤️ Liking ${reply.authorHandle}'s reply (LIKE_ONLY)`);
      likesGiven++;
      continue;
    }

    if (classification.engagementDecision !== "REPLY" && classification.engagementDecision !== "REPLY_AND_LIKE") {
      continue;
    }

    // === PAUSE FOR OPERATOR DECISION ===
    console.log(`  💬 Pausing for your decision on ${reply.authorHandle}'s reply...`);
    const decision = await promptReplyDecision(
      reply.authorHandle,
      `[Replying to a comment on your tweet]\n\nOriginal tweet: ${threadData.rootTweetText}\n\nComment from ${reply.authorHandle}: ${reply.text}`
    );

    if (decision === "skip" || decision === "timeout") {
      console.log(`  ⏭ ${decision === "skip" ? "Operator chose to skip" : "No response, skipping"} ${reply.authorHandle}`);
      continue;
    }

    if (decision === "myself") {
      // Open a fresh tab for this reply's own permalink before posting
      const replyPermalink = `https://x.com/${reply.authorHandle.replace(/^@/, "")}/status/${reply.id}`;
      const replyPage = await context.newPage();
      try {
        await replyPage.goto(replyPermalink, { waitUntil: "domcontentloaded", timeout: 15000 });
        await replyPage.waitForSelector("article", { timeout: 10000 });
        await new Promise(r => setTimeout(r, 1800));
      } catch {
        console.log(`  ⚠️ Could not navigate to reply page for manual reply`);
      }

      const manualResult = await postManualReply(replyPage, reply.authorHandle, reply.id);
      if (manualResult.posted) {
        addReplyNode(threadData.rootTweetId, {
          replyId: `echo-${Date.now()}`,
          authorHandle: echoHandle,
          text: manualResult.finalReply,
          parentReplyId: reply.id,
          depth: reply.depth + 1,
          createdAt: Date.now(),
          isByMe: true,
        });
        repliesPosted++;
        console.log(`  ✅ Manual reply posted to ${reply.authorHandle}`);
      }
      await replyPage.close().catch(() => {});
      await pace();
      continue;
    }

    // === CHATGPT GENERATION ===
    console.log(`  💬 Generating reply to ${reply.authorHandle} via ChatGPT...`);
    const conversationContext = buildConversationContext(threadData.rootTweetId, threadData.rootTweetText);
    const prompt = genAIEngagePrompt(threadData, reply, conversationContext);

    let aiReply = "";
    let bestReply = "";
    let bestScore = -1;

    for (let i = 0; i < 3; i++) {
      try {
        aiReply = await chatgpt.generateReply({
          tweet: prompt,
          relationship: "stranger",
          memories: await memoryRepo.getRecentMemories(20),
        });
      } catch (err) {
        log(`[Engage] ChatGPT attempt ${i + 1} failed: ${err}`);
        aiReply = "";
        continue;
      }

      if (!validateReply(aiReply) || isDuplicate(aiReply)) {
        aiReply = "";
        continue;
      }

      const [judged] = await judgeReplies(threadData.rootTweetText, [aiReply]);
      if (judged && judged.valid && judged.score > bestScore) {
        bestReply = aiReply;
        bestScore = judged.score;
      }

      if (judged?.worthPosting) break;
      if (judged && !judged.valid) {
        log(`[Engage] Attempt ${i + 1} was invalid (${judged.reason || "no reason"}) — regenerating.`);
        aiReply = "";
        continue;
      }
      log(`[Engage] Attempt ${i + 1} not worth posting (${judged?.reason ?? "no reason"}) — regenerating.`);
      aiReply = "";
    }

    if (!aiReply && bestReply) {
      log(`[Engage] No draft cleared the bar — using best-effort fallback (score ${bestScore}).`);
      aiReply = bestReply;
    }

    if (!aiReply || !validateReply(aiReply)) {
      console.log(`  ❌ Failed to generate a valid reply for ${reply.authorHandle} — skipping.`);
      continue;
    }

    console.log(`  ✏️ Draft: "${aiReply}"`);

    // === POST THE REPLY ===
    // Open a fresh tab for this reply's own permalink so the reply is
    // threaded under the correct comment, not the root tweet.
    const replyPermalink = `https://x.com/${reply.authorHandle.replace(/^@/, "")}/status/${reply.id}`;
    const replyPage = await context.newPage();
    try {
      await replyPage.goto(replyPermalink, { waitUntil: "domcontentloaded", timeout: 15000 });
      await replyPage.waitForSelector("article", { timeout: 10000 });
      // Wait for replies to mount (same 1.8s wait catchupPriorityHandles uses)
      await new Promise(r => setTimeout(r, 1800));
    } catch (err) {
      log(`[Engage] Failed to navigate to reply page: ${err}`);
      await replyPage.close().catch(() => {});
      continue;
    }

    // Check reply availability
    const replyButton = replyPage.locator('[data-testid="reply"]').first();
    if (!(await replyButton.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.log(`  ⚠️ Reply button unavailable for ${replyPermalink} — skipping.`);
      await replyPage.close().catch(() => {});
      continue;
    }

    try {
      await prepareReply(replyPage, aiReply, reply.id);
      const success = await clickReply(replyPage, reply.authorHandle);
      if (success) {
        addReplyNode(threadData.rootTweetId, {
          replyId: `echo-${Date.now()}`,
          authorHandle: echoHandle,
          text: aiReply,
          parentReplyId: reply.id,
          depth: reply.depth + 1,
          createdAt: Date.now(),
          isByMe: true,
        });
        repliesPosted++;
        console.log(`  ✅ Replied to ${reply.authorHandle}: "${aiReply}"`);
      } else {
        console.log(`  ❌ Failed to post reply to ${reply.authorHandle}`);
      }
    } catch (err) {
      console.error(`  ❌ Error posting reply: ${err}`);
    } finally {
      await replyPage.close().catch(() => {});
    }

    // Human-like wait between replies
    if (repliesPosted > 0 && considered < repliesToProcess.length) {
      const waitTime = getNextWaitTime(repliesPosted);
      console.log(`\n⏳ Waiting ${formatWaitTime(waitTime)} before next reply...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
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