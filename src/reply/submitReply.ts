import { Page } from "playwright";

const DRY_RUN = process.env.DRY_RUN === "true";

export async function submitReply(page: Page): Promise<boolean> {
  if (DRY_RUN) {
    console.log("Ready to post (dry run mode - not posting)");
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
          console.log(`Button ${selector} found but not visible`);
          continue;
        }
        
        try {
          console.log(`Clicking button: ${selector}`);
          await button.click({ timeout: 10000 });
          console.log("Button clicked successfully");
        } catch (err) {
          console.log(`Button click failed: ${err}`);
          // Button click failed, try next selector
          continue;
        }
        
        // Wait for composer to close (indicates success)
        // Use a short timeout and don't fail if it doesn't close
        // This is a non-fatal check - the post may still have succeeded
        page.waitForSelector(
          '[data-testid="tweetTextarea_0"]',
          {
            state: "hidden",
            timeout: 5000
          }
        ).catch(() => {
          console.log("Composer still open, but post may have succeeded");
        });
        
        return true;
      }
    }
    
    if (attempt === 0) {
      console.log("Retrying...");
      await page.waitForTimeout(3000);
    }
  }

  console.log("No post button found or all attempts failed");
  return false;
}
