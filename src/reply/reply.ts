import { Page } from "playwright";
import { openReplyBox } from "./openReplyBox";
import { typeReply } from "./typeReply";
import { submitReply } from "./submitReply";
import { logReply } from "../core/logger";
import { recordReplyForHour } from "../storage/hourlyReplyStats";

// Fill the reply textbox (without submitting)
export async function prepareReply(
  page: Page,
  reply: string,
  targetTweetId?: string
): Promise<void> {
  // Click the reply button
  await openReplyBox(page, targetTweetId);

  // Type the reply
  await typeReply(page, reply);
}

// Read the current text from the browser's reply box
export async function getBrowserReply(page: Page): Promise<string> {
  const editor = page.locator(
    '[data-testid="tweetTextarea_0"]'
  );

  return (await editor.innerText()).trim();
}

// Submit the reply (click the button)
export async function clickReply(
  page: Page,
  author: string = ""
): Promise<boolean> {
  // Submit (or just log in dry-run mode)
  const success = await submitReply(page);

  // Log the result
  logReply({
    tweet: page.url(),
    author,
    reply: "",
    success,
    time: new Date().toISOString()
  });

  // Every reply-posting path in this codebase (main-interactive.ts,
  // notifications.ts/engage.ts via processReply.ts, catchup/runCatchup.ts,
  // postManualReply.ts) funnels through this one function, so recording the
  // hourly count here — instead of at each caller individually — is what
  // makes storage/hourlyReplyStats.ts an accurate total across all of them.
  if (success) {
    await recordReplyForHour().catch(() => {});
  }

  return success;
}

// Original function for backward compatibility
export async function replyToTweet(
  page: Page,
  reply: string,
  author: string = ""
): Promise<boolean> {
  // Click the reply button
  await openReplyBox(page);

  // Type the reply
  await typeReply(page, reply);

  // Routed through clickReply() (rather than a second submitReply()/
  // logReply() of its own) so this path also counts toward
  // storage/hourlyReplyStats.ts instead of silently under-reporting it.
  return clickReply(page, author);
}

// Verify the post button exists
export async function verifyPostButton(page: Page): Promise<number> {
  // Try multiple possible selectors for the post button
  const sendButton = await page.locator('[data-testid="sendButton"]').count();
  const tweetButton = await page.locator('[data-testid="tweetButton"]').count();
  const tweetButtonInline = await page.locator('[data-testid="tweetButtonInline"]').count();
  
  return sendButton + tweetButton + tweetButtonInline;
}