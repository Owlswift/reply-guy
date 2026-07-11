import { peek, dequeue, updateItem } from "../core/queue";
import { generateReply } from "../ai/generateReply";
import { buildPersonalityPrompt } from "../personality/prompt";
import { validateReply } from "../personality/validator";
import { isDuplicate } from "../personality/duplicate";
import { log } from "../utils/logger";
import { stats } from "../stats/runtime";
import { sessionManager } from "../core/sessionManager";

export async function runAIWorker() {
  console.log("[AIWorker] Starting AI worker...");
  
  while (true) {
    // Check if review session is active - if so, wait
    if (sessionManager.isReviewing()) {
      console.log("[AIWorker] Review session active, waiting...");
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    const item = peek();

    if (!item) {
      console.log("[AIWorker] No items in queue, waiting...");
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    // Only process items that are "pending" (not already processed)
    if (item.status !== "pending") {
      console.log(`[AIWorker] Item ${item.id} status is ${item.status}, skipping...`);
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    console.log(`[AIWorker] Processing item ${item.id}...`);

    // Lock the item to prevent race conditions
    updateItem(item.id, { status: "drafting" });

    try {
      // Build prompt
      const prompt = buildPersonalityPrompt(item.text, "stranger", "general", []);

      // Generate reply with validation
      let reply = "";
      for (let i = 0; i < 3; i++) {
        console.log(`[AIWorker] Generating reply attempt ${i + 1}...`);
        reply = await generateReply(prompt);

        if (validateReply(reply) && !isDuplicate(reply)) {
          console.log(`[AIWorker] Valid reply generated for ${item.id}`);
          break;
        }

        console.log(`[AIWorker] Retry ${i + 1} - invalid or duplicate reply`);
      }

      if (!reply) {
        console.log(`[AIWorker] Failed to generate valid reply for ${item.id}`);
        updateItem(item.id, {
          status: "failed",
          attempts: (item.attempts || 0) + 1
        });
        // Remove from queue after max attempts to prevent infinite loop
        if ((item.attempts || 0) + 1 >= 3) {
          dequeue();
          console.log(`[AIWorker] Max attempts reached for ${item.id}, removing from queue`);
        }
        continue;
      }

      // Mark as ready for browser worker
      updateItem(item.id, {
        status: "ready",
        draft: reply
      });

      stats.regenerated++;
      console.log(`[AIWorker] Item ${item.id} ready for review`);

    } catch (err) {
      console.error(`[AIWorker] Error for ${item.id}:`, err);
      updateItem(item.id, {
        status: "failed",
        attempts: (item.attempts || 0) + 1
      });
    }
  }
}