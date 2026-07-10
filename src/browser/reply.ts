import { getPage } from "./browser";

export async function reply(tweetId: string, text: string) {
  const page = await getPage();
  
  // Navigate to the tweet
  await page.goto(`https://x.com/i/status/${tweetId}`);
  
  // Wait for reply button and click it
  const replyButton = page.locator('[data-testid="reply"]');
  await replyButton.click();
  
  // Wait for reply box to appear
  const replyBox = page.locator('[data-testid="tweetTextarea_0"]');
  await replyBox.fill(text);
  
  // Click send button
  const sendButton = page.locator('[data-testid="sendButton"]');
  await sendButton.click();
}