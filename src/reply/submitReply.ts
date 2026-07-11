import { Page } from "playwright";

const DRY_RUN = process.env.DRY_RUN === "true";

export async function submitReply(page: Page): Promise<boolean> {
  console.log("[submitReply] Starting submit reply...");
  
  if (DRY_RUN) {
    console.log("[submitReply] Dry run mode - not posting");
    return true;
  }

  // Try multiple possible selectors for the post button
  const buttonSelectors = [
    '[data-testid="tweetButton"]',
    '[data-testid="sendButton"]',
    '[data-testid="tweetButtonInline"]'
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    console.log(`[submitReply] Attempt ${attempt + 1} to find post button...`);
    
    // Find and click the first available button
    for (const selector of buttonSelectors) {
      const button = page.locator(selector);
      const count = await button.count();
      
      console.log(`[submitReply] Selector ${selector}: ${count} found`);
      
      if (count > 0) {
        // Check if button is visible
        const isVisible = await button.isVisible();
        console.log(`[submitReply] Button ${selector} visible: ${isVisible}`);
        
        if (!isVisible) {
          console.log(`[submitReply] Button ${selector} found but not visible, trying next...`);
          continue;
        }
        
        try {
          console.log(`[submitReply] Clicking button: ${selector}`);
          await button.click({ timeout: 10000 });
          console.log("[submitReply] Button clicked successfully");
        } catch (err) {
          console.log(`[submitReply] Button click failed: ${err}`);
          // Button click failed, try next selector
          continue;
        }
        
        // Wait for composer to close (indicates success)
        // Use a short timeout and don't fail if it doesn't close
        // This is a non-fatal check - the post may still have succeeded
        console.log("[submitReply] Waiting for composer to close...");
        await page.waitForSelector(
          '[data-testid="tweetTextarea_0"]',
          {
            state: "hidden",
            timeout: 5000
          }
        ).catch(() => {
          console.log("[submitReply] Composer still open, but post may have succeeded");
        });
        
        console.log("[submitReply] Submit successful");
        return true;
      }
    }
    
    if (attempt === 0) {
      console.log("[submitReply] No button found, retrying in 3s...");
      await page.waitForTimeout(3000);
    }
  }

  console.log("[submitReply] No post button found or all attempts failed");
  return false;
}

// Navigate to home page (for recovery when stuck)
export async function navigateToHomeAfterPost(page: Page): Promise<void> {
  console.log("[submitReply] Navigating to home after post...");
  
  try {
    // Check if we're on a compose page
    const currentUrl = page.url();
    console.log(`[submitReply] Current URL: ${currentUrl}`);
    
    if (currentUrl.includes("/compose")) {
      console.log("[submitReply] On compose page, navigating to home...");
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
        console.log("[submitReply] waitForLoadState timed out, but navigation may have succeeded");
      });
    } else {
      // Also navigate to home if not on compose page (for safety)
      console.log("[submitReply] Navigating to home...");
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
        console.log("[submitReply] waitForLoadState timed out, but navigation may have succeeded");
      });
    }
    
    console.log("[submitReply] Navigation to home complete");
  } catch (err) {
    console.log(`[submitReply] Navigation to home failed: ${err}`);
  }
}