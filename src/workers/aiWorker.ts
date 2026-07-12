import { peek, dequeue, updateItem } from "../core/queue";
import { runReplyPipeline } from "../ai/replyPipeline";
import { validateReply } from "../personality/validator";
import { isDuplicate } from "../personality/duplicate";
import { log } from "../utils/logger";
import { stats } from "../stats/runtime";
import { sessionManager } from "../core/sessionManager";
import { MemoryRepository } from "../database/MemoryRepository";

const memoryRepo = new MemoryRepository();

export async function runAIWorker() {
  while (true) {
    // Check if review session is active - if so, wait
    if (sessionManager.isReviewing()) {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    const item = peek();

    if (!item) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    // Only process items that are "pending" (not already processed)
    if (item.status !== "pending") {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    // Lock the item to prevent race conditions
    updateItem(item.id, { status: "drafting" });

    try {
      // Load past replies so the AI learns from your approved/edited responses
      const memories = await memoryRepo.getRecentMemories(20);

      // Build few-shot examples from memories
      const examples = memories.slice(0, 5).map(m => ({
        tweet: m.tweetText,
        reply: m.finalReply,
      }));

      // Run the full pipeline: Understand → Brainstorm → Write → Judge
      const { bestReply } = await runReplyPipeline({
        tweet: item.text,
        author: item.author,
        examples,
      });

      if (!bestReply || !validateReply(bestReply) || isDuplicate(bestReply)) {
        updateItem(item.id, {
          status: "failed",
          attempts: (item.attempts || 0) + 1
        });
        if ((item.attempts || 0) + 1 >= 3) {
          dequeue();
        }
        continue;
      }

      // Mark as ready for browser worker
      updateItem(item.id, {
        status: "ready",
        draft: bestReply
      });

      stats.regenerated++;

    } catch (err) {
      console.error(`AI error for ${item.id}:`, err);
      updateItem(item.id, {
        status: "failed",
        attempts: (item.attempts || 0) + 1
      });
    }
  }
}
