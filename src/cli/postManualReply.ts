import { Page } from "playwright";
import { prepareReply, clickReply } from "../reply/reply";
import { promptWithTimeout } from "../utils/interactivePrompt";
import { log } from "../utils/logger";

// How long to wait for a manually-typed reply, or for "press Enter once
// you've replied in the browser" — generous on purpose. Unlike the 20s
// myself-vs-chatgpt decision gate, the operator has already committed to
// answering by hand here, so it shouldn't rush them off a phone or a
// slower typing session.
const MANUAL_REPLY_TIMEOUT_MS = 10 * 60 * 1000;

export type ManualReplyResult =
  | { posted: true; finalReply: string }
  | { posted: false };

/**
 * Detect whether @unfairleverage has already replied in the open thread.
 * Looks for your handle link inside any article after the root tweet, to
 * avoid false matches from sidebar profile cards or "Replying to" text.
 */
export async function hasManualReply(page: Page): Promise<boolean> {
  const allArticles = page.locator("article");
  const articleCount = await allArticles.count();
  for (let a = 1; a < articleCount; a++) {
    const linkCount = await allArticles.nth(a).locator('a[href="/unfairleverage"]').count();
    if (linkCount > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Prompt for (or accept blank + browser-typed) a manual reply and post it.
 * Shared by every "answer it myself" path — the image gate, the
 * gated-handle prompt, and the priority-handle catch-up command — so the
 * prompting/posting logic and its bugs only exist in one place.
 *
 * Returns whether something was actually posted, and the final reply text
 * if typed at the prompt (or a placeholder if it was typed directly in the
 * browser) — callers own their own bookkeeping (markReplied, stats,
 * memory) based on this result, since that differs between callers.
 */
export async function postManualReply(page: Page, authorHandle: string, targetTweetId?: string): Promise<ManualReplyResult> {
  const manualReply = await promptWithTimeout(
    "\nType your reply and press Enter to post it (leave blank if you'd rather type it directly in the browser): ",
    MANUAL_REPLY_TIMEOUT_MS
  );

  if (manualReply) {
    try {
      await prepareReply(page, manualReply, targetTweetId);
      const success = await clickReply(page, authorHandle);
      if (success) {
        return { posted: true, finalReply: manualReply };
      }
      log("Failed to post manual reply.");
      return { posted: false };
    } catch (err) {
      console.error("Failed to post manual reply:", err);
      return { posted: false };
    }
  }

  // No text typed — assume they'll reply directly in the browser UI.
  console.log("Reply to it directly in the browser now.");
  await promptWithTimeout("Press Enter once you've replied (or to skip)...\n", MANUAL_REPLY_TIMEOUT_MS);

  if (await hasManualReply(page)) {
    log("Manual reply detected.");
    return { posted: true, finalReply: "(typed directly in browser)" };
  }
  log("No manual reply detected. Skipping.");
  return { posted: false };
}
