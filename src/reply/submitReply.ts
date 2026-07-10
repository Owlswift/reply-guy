import { Page } from "playwright";

const DRY_RUN = true;

export async function submitReply(page: Page): Promise<boolean> {
  if (DRY_RUN) {
    console.log("Ready to post (dry run mode - not posting)");
    return true;
  }

  // Retry logic
  for (let i = 0; i < 2; i++) {
    try {
      const button = page.locator(
        '[data-testid="tweetButton"]'
      );

      await button.click({ timeout: 10000 });

      // Wait for composer to close (indicates success)
      await page.waitForSelector(
        '[data-testid="tweetTextarea_0"]',
        {
          state: "hidden",
          timeout: 10000
        }
      );

      return true;
    } catch (err) {
      if (i === 0) {
        console.log("Retrying...");
        await page.waitForTimeout(3000);
      }
    }
  }

  return false;
}