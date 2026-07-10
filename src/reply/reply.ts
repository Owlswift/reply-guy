import { Page } from "playwright";
import { openReplyBox } from "./openReplyBox";
import { typeReply } from "./typeReply";
import { submitReply } from "./submitReply";
import { logReply } from "../core/logger";

export async function replyToTweet(
  page: Page,
  reply: string,
  author: string = ""
): Promise<boolean> {
  // Click the reply button
  await openReplyBox(page);

  // Type the reply
  await typeReply(page, reply);

  // Submit (or just log in dry-run mode)
  const success = await submitReply(page);

  // Log the result
  logReply({
    tweet: page.url(),
    author,
    reply,
    success,
    time: new Date().toISOString()
  });

  return success;
}

// Verify the post button exists
export async function verifyPostButton(page: Page): Promise<number> {
  // Try multiple possible selectors for the post button
  const sendButton = await page.locator('[data-testid="sendButton"]').count();
  const tweetButton = await page.locator('[data-testid="tweetButton"]').count();
  const tweetButtonInline = await page.locator('[data-testid="tweetButtonInline"]').count();
  
  return sendButton + tweetButton + tweetButtonInline;
}