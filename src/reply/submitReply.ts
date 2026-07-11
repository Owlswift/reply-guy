import { Page } from "playwright";

const DRY_RUN = process.env.DRY_RUN === "true";

export async function submitReply(page: Page): Promise<boolean> {
  if (DRY_RUN) {
    return true;
  }

  // Try multiple possible selectors for the post button
  const buttonSelectors = [
    '[data-testid="tweetButton"]',
    '[data-testid="sendButton"]',
    '[data-testid="tweetButtonInline"]'
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    // Find and click the first available button
    for (const selector of buttonSelectors) {
      const button = page.locator(selector);
      const count = await button.count();
      
      if (count > 0) {
        // Check if button is visible
        const isVisible = await button.isVisible();
        if (!isVisible) {
          continue;
        }
        
        try {
          await button.click({ timeout: 10000 });
        } catch {
          // Button click failed, try next selector
          continue;
        }
        
        // Wait for composer to close (indicates success)
        // Use a short timeout and don't fail if it doesn't close
        // This is a non-fatal check - the post may still have succeeded
        await page.waitForSelector(
          '[data-testid="tweetTextarea_0"]',
          {
            state: "hidden",
            timeout: 5000
          }
        ).catch(() => {
          // Composer still open, but post may have succeeded
        });
        
        return true;
      }
    }
    
    if (attempt === 0) {
      await page.waitForTimeout(3000);
    }
  }

  return false;
}

// Navigate to notifications feed (for recovery when stuck)
export async function navigateToHomeAfterPost(page: Page): Promise<void> {
  try {
    // Check if we're on a compose page
    const currentUrl = page.url();
    if (currentUrl.includes("/compose")) {
      await page.goto("https://x.com/notifications", { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
        // waitForLoadState timed out, but navigation may have succeeded
      });
    } else {
      // Also navigate to notifications if not on compose page (for safety)
      await page.goto("https://x.com/notifications", { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
        // waitForLoadState timed out, but navigation may have succeeded
      });
    }
  } catch {
    // Navigation to notifications failed
  }
}
