import { getQueue, findPending, updateItem, QueueItem } from "../core/queue";
import { generateReply } from "../ai/ollama";
import { classifyTweet } from "../ai/classifyTweet";
import { getRelationship } from "../relationship/getRelationship";
import { log } from "../utils/logger";
import { Page } from "playwright";

export async function runAIWorker(page: Page): Promise<void> {
  while (true) {
    const next = findPending();

    if (!next) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    try {
      // Mark as drafting
      updateItem(next.id, { status: "drafting" });

      // Get relationship if not already set
      let relationship = next.relationship;
      if (!relationship) {
        // We need to open the tweet to get relationship
        // For now, use default
        relationship = "stranger";
      }

      // Generate reply
      log(`AI generating reply for ${next.id}`);
      const draft = await generateReply(next.text, relationship);

      // Update with draft
      updateItem(next.id, {
        draft,
        status: "ready",
        tweetType: classifyTweet(next.text)
      });

      log(`AI reply ready for ${next.id}`);
    } catch (err) {
      console.error(`AI error for ${next.id}:`, err);
      updateItem(next.id, {
        status: "failed",
        attempts: (next.attempts || 0) + 1
      });
    }
  }
}