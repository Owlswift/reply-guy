import "dotenv/config";
import { getBrowserAndContext } from "./browser/browser";
import {
  dequeueNextReplyJob,
  requeueReplyJob,
  getQueueSize,
  ReplyJob,
} from "./storage/replyQueue";
import { prepareReply, clickReply } from "./reply/reply";
import { markReplied, isPermanentlySkipped } from "./storage/repliedTweets";
import { markUrlReplied } from "./storage/repliedUrls";
import { addReplyNode, hasRepliedToReply } from "./engage/threadConversationTracker";
import { MemoryRepository } from "./database/MemoryRepository";
import { getTodayReplyCount } from "./storage/hourlyReplyStats";
import { randomDelayMs } from "./behavior/delays";
import { log } from "./utils/logger";

// Same daily ceiling main-interactive.ts used to gate its own posting with
// (DAILY_LIMIT) — now enforced here instead, since the dispatcher is the
// only thing that actually posts.
const DAILY_LIMIT = 600;

// How long to wait before opening the tab and posting, once a job is
// dequeued — this is the actual "doesn't look automated" pacing. Ranges
// deliberately don't overlap much across sources so a burst produced by
// one command doesn't all land back-to-back just because they share a
// tier — each draw is independent regardless of source.
const DELAY_RANGES_MS: Record<ReplyJob["source"], [number, number]> = {
  conversation: [10_000, 30_000],
  interactive: [25_000, 100_000],
  catchup_priority: [40_000, 100_000],
  catchup_stories: [60_000, 120_000],
  catchup_forex_crypto: [10_000, 40_000],
};

// How often to check the queue when it's empty, or when the daily cap is
// blocking further posts this cycle.
const IDLE_POLL_MS: [number, number] = [5_000, 150_000];

async function alreadyHandled(job: ReplyJob): Promise<boolean> {
  if (job.onPosted.type === "conversation") {
    return hasRepliedToReply(job.onPosted.rootTweetId, job.onPosted.parentReplyId);
  }
  return isPermanentlySkipped(job.tweetId);
}

async function runOnPostedHandler(job: ReplyJob, memoryRepo: MemoryRepository): Promise<void> {
  const handler = job.onPosted;

  if (handler.type === "main_interactive") {
    markReplied(handler.itemId, handler.reason);
    await markUrlReplied(handler.url).catch(() => {});
    if (handler.memory) {
      try {
        await memoryRepo.saveMemory({
          id: "",
          ...handler.memory,
          wasEdited: false,
          approved: true,
          createdAt: new Date(),
        });
      } catch {}
    }
    return;
  }

  if (handler.type === "conversation") {
    addReplyNode(handler.rootTweetId, {
      replyId: `echo-${Date.now()}`,
      authorHandle: handler.echoHandle,
      text: handler.text,
      parentReplyId: handler.parentReplyId,
      depth: handler.depth,
      createdAt: Date.now(),
      isByMe: true,
    });
    return;
  }

  // catchup
  markReplied(handler.tweetId, handler.reason);
  if (handler.memory) {
    try {
      await memoryRepo.saveMemory({
        id: "",
        ...handler.memory,
        wasEdited: false,
        approved: true,
        createdAt: new Date(),
      });
    } catch {}
  }
}

async function main() {
  console.log("");
  console.log("  ╔═══════════════════════════════════════════╗");
  console.log("  ║     Echo Dispatcher — Reply Queue          ║");
  console.log("  ╚═══════════════════════════════════════════╝");
  console.log("");

  const { context } = await getBrowserAndContext();
  const memoryRepo = new MemoryRepository();

  log("[Dispatcher] Ready — draining the shared reply queue.");

  while (true) {
    const todayCount = await getTodayReplyCount().catch(() => 0);
    if (todayCount >= DAILY_LIMIT) {
      const idleMs = randomDelayMs(...IDLE_POLL_MS);
      log(`[Dispatcher] Daily limit reached (${todayCount}/${DAILY_LIMIT}) — checking again in ${Math.round(idleMs / 1000)}s.`);
      await new Promise((r) => setTimeout(r, idleMs));
      continue;
    }

    const job = await dequeueNextReplyJob().catch((err) => {
      log(`[Dispatcher] Failed to read from the queue, backing off: ${err}`);
      return null;
    });

    if (!job) {
      const idleMs = randomDelayMs(...IDLE_POLL_MS);
      await new Promise((r) => setTimeout(r, idleMs));
      continue;
    }

    log(`[Dispatcher] Picked up ${job.source} job for ${job.tweetUrl} (priority ${job.priority}, attempt ${job.retryCount + 1}).`);

    // The producer already deduped at decide-time, but the job may have
    // sat in the queue a while — re-check right before spending a tab-open
    // on it, same reasoning as every other "cheap dedup before opening a
    // tab" check elsewhere in this codebase.
    if (await alreadyHandled(job)) {
      log(`[Dispatcher] ${job.tweetUrl} was already answered by the time this job came up — dropping.`);
      continue;
    }

    const [minMs, maxMs] = DELAY_RANGES_MS[job.source];
    const waitMs = randomDelayMs(minMs, maxMs);
    log(`[Dispatcher] Waiting ${Math.round(waitMs / 1000)}s before posting (source: ${job.source}).`);
    await new Promise((r) => setTimeout(r, waitMs));

    const page = await context.newPage();
    let success = false;
    try {
      await page.goto(job.tweetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForSelector("article", { timeout: 15_000 });
      await new Promise((r) => setTimeout(r, 1800));

      const replyButton = page.locator('[data-testid="reply"]').first();
      if (!(await replyButton.isVisible({ timeout: 5000 }).catch(() => false))) {
        log(`[Dispatcher] Reply unavailable for ${job.tweetUrl} — treating as a failed attempt.`);
      } else {
        await prepareReply(page, job.replyText, job.tweetId);
        success = await clickReply(page, job.authorHandle);
      }
    } catch (err) {
      log(`[Dispatcher] Error posting to ${job.tweetUrl}: ${err}`);
    } finally {
      await page.close().catch(() => {});
    }

    if (success) {
      log(`[Dispatcher] Posted to ${job.tweetUrl}.`);
      await runOnPostedHandler(job, memoryRepo);
    } else {
      const requeued = await requeueReplyJob(job);
      if (requeued) {
        log(`[Dispatcher] Failed to post to ${job.tweetUrl} — requeued (attempt ${job.retryCount + 2} next).`);
      } else {
        log(`[Dispatcher] Failed to post to ${job.tweetUrl} after ${job.retryCount + 1} attempts — giving up.`);
        if (job.onPosted.type !== "conversation") {
          markReplied(job.tweetId, `dispatcher failed to post after ${job.retryCount + 1} attempts`);
        }
      }
    }

    const remaining = await getQueueSize().catch(() => null);
    if (remaining !== null) {
      log(`[Dispatcher] ${remaining} job(s) remaining in the queue.`);
    }
  }
}

main().catch((err) => {
  console.error("[Dispatcher] Fatal error:", err);
  process.exit(1);
});
