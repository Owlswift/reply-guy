import { Page } from "playwright";

export async function typeReply(page: Page, text: string): Promise<void> {
  // Wait for reply box to appear
  const replyBox = page.locator('[data-testid="tweetTextarea_0"]');
  await replyBox.waitFor({ state: "visible", timeout: 10000 });
  
  // Type the reply
  await replyBox.fill(text);
}

export async function clickSend(page: Page): Promise<void> {
  // Click send button
  const sendButton = page.locator('[data-testid="sendButton"]');
  await sendButton.click();
  
  // Wait a moment for the reply to be sent
  await page.waitForTimeout(1000);
}