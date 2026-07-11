import { Page } from "playwright";

export async function openReplyBox(page: Page): Promise<void> {
  // First, dismiss any open modals (image viewer, login popup, etc.)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const replyButton = page.locator('[data-testid="reply"]');

  await replyButton.first().click({ timeout: 10000 });

  await page.waitForSelector(
    '[data-testid="tweetTextarea_0"]',
    { timeout: 10000 }
  );
}
