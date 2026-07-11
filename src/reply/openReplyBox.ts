import { Page } from "playwright";

export async function openReplyBox(page: Page): Promise<void> {
  console.log("[openReplyBox] Dismissing any open modals...");
  // First, dismiss any open modals (image viewer, login popup, etc.)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  console.log("[openReplyBox] Finding reply button...");
  const replyButton = page.locator('[data-testid="reply"]');

  console.log("[openReplyBox] Clicking reply button...");
  await replyButton.first().click({ timeout: 10000 });

  console.log("[openReplyBox] Waiting for reply textarea...");
  await page.waitForSelector(
    '[data-testid="tweetTextarea_0"]',
    { timeout: 10000 }
  );
  console.log("[openReplyBox] Reply box opened successfully");
}