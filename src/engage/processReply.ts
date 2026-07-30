import { BrowserContext, Page } from "playwright";
import { ChatGPTClient } from "../ai/chatgpt";
import { judgeReplies } from "../ai/judgeReply";
import { validateReply } from "../personality/validator";
import { isDuplicate } from "../personality/duplicate";
import { MemoryRepository } from "../database/MemoryRepository";
import { postManualReply } from "../cli/postManualReply";
import { promptReplyDecision } from "../cli/promptReplyDecision";
import { log } from "../utils/logger";
import { genAIEngagePrompt } from "./engagePrompt";
import {
  extractReplyPermalinkContext,
  ThreadData,
  ExtractedReply,
} from "./extractThreadReplies";
import { addReplyNode, buildConversationContext } from "./threadConversationTracker";
import { ReplyClassification, ReplyClass } from "./types";
// Dispatcher wiring — disconnected for now so scripts post directly/independently again.
// See src/dispatcher.ts and src/storage/replyQueue.ts to re-enable.
// import { enqueueReplyJob } from "../storage/replyQueue";
import { prepareReply, clickReply } from "../reply/reply";

const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 9000;

export async function pace(): Promise<void> {
  const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  await new Promise(r => setTimeout(r, delay));
}

export function shouldSkipReply(classification: ReplyClassification): boolean {
  const skipClasses: ReplyClass[] = ["SPAM", "BOT", "EMOJI_ONLY", "TAGGING_FRIEND"];
  if (skipClasses.includes(classification.replyClass)) return true;
  if (classification.engagementDecision === "IGNORE") return true;
  return false;
}

export function shouldEndConversation(classification: ReplyClassification): boolean {
  return classification.engagementDecision === "END_CONVERSATION";
}

// Short closing acknowledgments — for replies that don't need or invite a
// real back-and-forth (simple agreement like "facts"/"this", but also
// praise, well-wishes, thank-yous, and other LIKE_ONLY-classified replies).
// A brief word/emoji back reads as a normal, warm way to close out a
// comment; posting nothing at all reads as ignoring them regardless of
// which of those categories the reply falls into.
const CLOSING_REACTIONS = [
  "facts",
  "exactly",
  "for sure",
  "appreciate you",
  "same here",
  "🔥",
  "💯",
  "🙏",
  "fr",
  "true that",
  "yea",
  "yeah exactly",
];

export function pickClosingReaction(): string {
  return CLOSING_REACTIONS[Math.floor(Math.random() * CLOSING_REACTIONS.length)]!;
}

/**
 * Post a short closing acknowledgment for a reply that doesn't need a real
 * generated response — either because it's simple agreement
 * (END_CONVERSATION) or because it's praise/well-wish/thanks/etc.
 * (LIKE_ONLY, which otherwise triggers no visible action at all).
 *
 * Dispatcher wiring disconnected for now (see commented-out block below) —
 * this posts directly again, independently, like every other script.
 */
export async function postClosingReaction(params: {
  browserContext: BrowserContext;
  threadData: ThreadData;
  reply: ExtractedReply;
  echoHandle: string;
  page?: Page;
}): Promise<boolean> {
  const { browserContext, threadData, reply, echoHandle } = params;
  const replyPermalink = `https://x.com/${reply.authorHandle.replace(/^@/, "")}/status/${reply.id}`;
  const replyPage = params.page ?? await browserContext.newPage();
  const reaction = pickClosingReaction();

  try {
    if (!params.page) {
      await replyPage.goto(replyPermalink, { waitUntil: "domcontentloaded", timeout: 15000 });
      await replyPage.waitForSelector("article", { timeout: 10000 });
      await new Promise(r => setTimeout(r, 1800));
    }

    const replyButton = replyPage.locator('[data-testid="reply"]').first();
    if (!(await replyButton.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.log(`  ⚠️ Reply button unavailable for ${replyPermalink} — skipping closing reaction.`);
      return false;
    }

    await prepareReply(replyPage, reaction, reply.id);
    const success = await clickReply(replyPage, reply.authorHandle);
    if (success) {
      addReplyNode(threadData.rootTweetId, {
        replyId: `echo-${Date.now()}`,
        authorHandle: echoHandle,
        text: reaction,
        parentReplyId: reply.id,
        depth: reply.depth + 1,
        createdAt: Date.now(),
        isByMe: true,
      });
      console.log(`  ✅ Reacted to ${reply.authorHandle}: "${reaction}"`);
      return true;
    }
    console.log(`  ❌ Failed to post closing reaction to ${reply.authorHandle}`);
    return false;
  } catch (err) {
    log(`[Engage] Error posting closing reaction to ${reply.authorHandle}: ${err}`);
    return false;
  } finally {
    await replyPage.close().catch(() => {});
  }

  // === DISPATCHER-QUEUED VERSION (disconnected for now) ===
  // Builds the job and pushes it onto storage/replyQueue.ts; src/dispatcher.ts
  // is the only thing that would post it, with its own humanized pacing.
  // Re-enable by swapping this in for the block above and dropping
  // browserContext/page from the signature again.
  //
  // try {
  //   await enqueueReplyJob({
  //     source: "conversation",
  //     priority: 1,
  //     tweetUrl: replyPermalink,
  //     tweetId: reply.id,
  //     authorHandle: reply.authorHandle,
  //     replyText: reaction,
  //     onPosted: {
  //       type: "conversation",
  //       rootTweetId: threadData.rootTweetId,
  //       parentReplyId: reply.id,
  //       echoHandle,
  //       text: reaction,
  //       depth: reply.depth + 1,
  //     },
  //   });
  //   console.log(`  📥 Queued a closing reaction for ${reply.authorHandle}: "${reaction}"`);
  //   return true;
  // } catch (err) {
  //   log(`[Engage] Failed to queue closing reaction for ${reply.authorHandle}: ${err}`);
  //   return false;
  // }
}

export interface ReplyOutcome {
  posted: boolean;
  // Whether we reached the ChatGPT generation section at all (used to decide
  // whether the rate-limit wait after this reply applies) — the "myself"
  // manual path paces itself internally instead.
  tookChatGptPath: boolean;
}

/**
 * Handle a single reply end-to-end.
 *
 * Opens the reply's OWN permalink in a dedicated tab first, and reads the
 * thread context X actually renders there — the tweet/comment directly
 * above it in the ancestor chain — before doing anything else with it.
 * The flat scan-page reconstruction (buildReplyTree's DOM-order +
 * @mention heuristic over the root tweet's page) can misattribute
 * parentage in nested threads, and the scanned root tweet itself can be
 * wrong if it's actually a reply to something else. Opening this reply's
 * own permalink sidesteps both: X shows the true parent unambiguously.
 * The same tab is then reused for posting, so we never guess twice.
 *
 * Pass `page` if the caller already has a tab open and navigated to this
 * reply's own permalink — ownership transfers here (it gets closed before
 * returning). Omit it to have this function open and navigate its own,
 * exactly like the original engage.ts behavior.
 */
export async function handleReply(params: {
  browserContext: BrowserContext;
  chatgpt: ChatGPTClient;
  memoryRepo: MemoryRepository;
  threadData: ThreadData;
  reply: ExtractedReply;
  echoHandle: string;
  page?: Page;
}): Promise<ReplyOutcome> {
  const { browserContext, chatgpt, memoryRepo, threadData, reply, echoHandle } = params;

  const replyPermalink = `https://x.com/${reply.authorHandle.replace(/^@/, "")}/status/${reply.id}`;
  const replyPage = params.page ?? await browserContext.newPage();

  try {
    let verifiedContext: Awaited<ReturnType<typeof extractReplyPermalinkContext>> = null;
    try {
      if (!params.page) {
        await replyPage.goto(replyPermalink, { waitUntil: "domcontentloaded", timeout: 15000 });
        await replyPage.waitForSelector("article", { timeout: 10000 });
        await new Promise(r => setTimeout(r, 1800));
      }
      verifiedContext = await extractReplyPermalinkContext(replyPage, reply.id, reply.authorHandle);
    } catch (err) {
      log(`[Engage] Failed to open reply page for ${reply.authorHandle}: ${err}`);
    }

    if (!verifiedContext) {
      console.log(`  ⚠️ Could not verify context for ${reply.authorHandle}'s reply — skipping.`);
      return { posted: false, tookChatGptPath: false };
    }

    // Is the tweet directly above this reply (in X's own ancestor chain)
    // the root tweet, or some other commenter's reply? Compared by handle
    // since exact text can differ slightly (truncation, "Show more", etc).
    const parentIsRoot =
      !verifiedContext.hasParent ||
      verifiedContext.parentAuthor.replace(/^@/, "").toLowerCase() ===
        threadData.rootTweetHandle.replace(/^@/, "").toLowerCase();

    const parentAuthor = parentIsRoot ? threadData.rootTweetHandle : verifiedContext.parentAuthor;
    const parentText = parentIsRoot ? threadData.rootTweetText : verifiedContext.parentText;
    const replyText = verifiedContext.replyText || reply.text;

    // === PAUSE FOR OPERATOR DECISION ===
    console.log(`  💬 Pausing for your decision on ${reply.authorHandle}'s reply...`);
    const previewLabel = parentIsRoot
      ? "Original tweet"
      : `Comment from ${parentAuthor || "another user"} (this reply is responding to THEM, not your tweet directly)`;
    const decision = await promptReplyDecision(
      reply.authorHandle,
      `[Replying to a comment on your tweet]\n\n${previewLabel}: ${parentText}\n\nComment from ${reply.authorHandle}: ${replyText}`
    );

    if (decision === "skip" || decision === "timeout") {
      console.log(`  ⏭ ${decision === "skip" ? "Operator chose to skip" : "No response, skipping"} ${reply.authorHandle}`);
      return { posted: false, tookChatGptPath: false };
    }

    if (decision === "myself") {
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
        console.log(`  ✅ Manual reply posted to ${reply.authorHandle}`);
        await pace();
        return { posted: true, tookChatGptPath: false };
      }
      return { posted: false, tookChatGptPath: false };
    }

    // === CHATGPT GENERATION ===
    console.log(`  💬 Generating reply to ${reply.authorHandle} via ChatGPT...`);
    const conversationContext = buildConversationContext(threadData.rootTweetId, threadData.rootTweetText);
    const memories = await memoryRepo.getRecentMemories(20);
    const prompt = genAIEngagePrompt(threadData, reply, conversationContext, memories, {
      author: parentAuthor,
      text: parentText,
      isRoot: parentIsRoot,
    });

    let aiReply = "";
    let bestReply = "";
    let bestScore = -1;

    for (let i = 0; i < 3; i++) {
      try {
        // Sent as-is (generateRawReply), not generateReply — this prompt is
        // already fully built for the comment-reply case; routing it through
        // the standalone-tweet personality pipeline would re-wrap it in
        // instructions for a different scenario (see genAIEngagePrompt).
        aiReply = await chatgpt.generateRawReply(prompt);
      } catch (err) {
        log(`[Engage] ChatGPT attempt ${i + 1} failed: ${err}`);
        aiReply = "";
        continue;
      }

      if (!validateReply(aiReply) || isDuplicate(aiReply)) {
        aiReply = "";
        continue;
      }

      const [judged] = await judgeReplies(threadData.rootTweetText, [aiReply], replyText);
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
      return { posted: false, tookChatGptPath: true };
    }

    console.log(`  ✏️ Draft: "${aiReply}"`);

    // === POST THE REPLY ===
    // Dispatcher wiring disconnected for now — posts directly again, see the
    // commented-out queued version below to re-enable.
    const replyButton = replyPage.locator('[data-testid="reply"]').first();
    if (!(await replyButton.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.log(`  ⚠️ Reply button unavailable for ${replyPermalink} — skipping.`);
      return { posted: false, tookChatGptPath: true };
    }

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
      console.log(`  ✅ Reply posted to ${reply.authorHandle}`);
      return { posted: true, tookChatGptPath: true };
    }
    console.log(`  ❌ Failed to post reply to ${reply.authorHandle}`);
    return { posted: false, tookChatGptPath: true };

    // === DISPATCHER-QUEUED VERSION (disconnected for now) ===
    // See storage/replyQueue.ts — src/dispatcher.ts is the only thing that
    // would post it, with its own humanized pacing. Re-enable by swapping
    // this in for the block above.
    //
    // try {
    //   await enqueueReplyJob({
    //     source: "conversation",
    //     priority: 1,
    //     tweetUrl: replyPermalink,
    //     tweetId: reply.id,
    //     authorHandle: reply.authorHandle,
    //     replyText: aiReply,
    //     onPosted: {
    //       type: "conversation",
    //       rootTweetId: threadData.rootTweetId,
    //       parentReplyId: reply.id,
    //       echoHandle,
    //       text: aiReply,
    //       depth: reply.depth + 1,
    //     },
    //   });
    //   console.log(`  📥 Queued reply to ${reply.authorHandle}: "${aiReply}"`);
    //   return { posted: true, tookChatGptPath: true };
    // } catch (err) {
    //   console.error(`  ❌ Failed to queue reply: ${err}`);
    //   return { posted: false, tookChatGptPath: true };
    // }
  } finally {
    await replyPage.close().catch(() => {});
  }
}
