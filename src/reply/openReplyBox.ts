import { Page } from "playwright";

export async function openReplyBox(page: Page): Promise<void> {
  const replyButton = page.locator('[data-testid="reply"]');

  await replyButton.first().click({ timeout: 10000 });

  await page.waitForSelector(
    '[data-testid="tweetTextarea_0"]',
    { timeout: 10000 }
  );
}