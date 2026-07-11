import { peek, dequeue, updateItem } from "../core/queue";
import { generateReply } from "../ai/generateReply";
import { buildPersonalityPrompt } from "../personality/prompt";
import { validateReply } from "../personality/validator";
import { isDuplicate } from "../personality/duplicate";
import { log } from "../utils/logger";
import { stats } from "../stats/runtime";
import { sessionManager } from "../core/sessionManager";

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
      // Build prompt
      const prompt = buildPersonalityPrompt(item.text, "stranger", "general", []);

      // Generate reply with validation
      let reply = "";
      for (let i = 0; i < 3; i++) {
        reply = await generateReply(prompt);

        if (validateReply(reply) && !isDuplicate(reply)) {
          break;
        }
      }

      if (!reply) {
        updateItem(item.id, {
          status: "failed",
          attempts: (item.attempts || 0) + 1
        });
        // Remove from queue after max attempts to prevent infinite loop
        if ((item.attempts || 0) + 1 >= 3) {
          dequeue();
        }
        continue;
      }

      // Mark as ready for browser worker
      updateItem(item.id, {
        status: "ready",
        draft: reply
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