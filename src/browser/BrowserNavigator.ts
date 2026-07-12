import { Page } from "playwright";
import { sessionManager } from "../core/sessionManager";
import { log } from "../utils/logger";

/**
 * BrowserNavigator - Single owner of all Playwright navigation
 * 
 * This is the ONLY component allowed to call page.goto, page.goBack, page.reload, etc.
 * All other components must express intent through this navigator.
 * 
 * This eliminates race conditions where multiple pieces of code try to navigate
 * the browser simultaneously.
 */

export class BrowserNavigator {
  constructor(public page: Page) {}

  /**
   * Navigate to the notification feed
   */
  async openNotificationFeed(): Promise<boolean> {
    this.assertNoActiveSession();
    
    try {
      log("[Navigator] Opening notification feed");
      await this.page.goto("https://x.com/notifications", {
        waitUntil: "domcontentloaded",
      });

      // Wait until notification cards are rendered
      try {
        await this.page.waitForLoadState("networkidle", { timeout: 5000 });
      } catch {
        // Continue anyway
      }
      
      try {
        await this.page.locator("article").first().waitFor({
          timeout: 15000
        });
      } catch {
        return false;
      }

      // Find notification cards that start with "New post notifications for"
      const card = this.page.locator("article").filter({
        has: this.page.getByText(/^New post notifications for/)
      });

      const count = await card.count();

      if (count === 0) {
        // No notification card — check if we're already on the i/timeline page
        const currentUrl = this.page.url();
        if (currentUrl.includes("/i/timeline")) {
          return true;
        }
        return true;
      }

      try {
        await card.first().waitFor({ timeout: 5000 });
        await card.first().click();
      } catch {
        return true;
      }

      // Wait for the Posts feed to open and verify we're on i/timeline
      try {
        await this.page.locator("article").first().waitFor({
          timeout: 5000
        });
      } catch {
        return false;
      }

      // Verify we landed on the i/timeline page (the filtered posts feed)
      const finalUrl = this.page.url();
      if (!finalUrl.includes("/i/timeline")) {
        console.log("Did not land on i/timeline page, navigating directly...");
        await this.navigateToTimeline();
        try {
          await this.page.locator("article").first().waitFor({ timeout: 10000 });
        } catch {
          return false;
        }
      }

      return true;
    } catch (error) {
      log(`[Navigator] Failed to open notification feed: ${error}`);
      return false;
    }
  }

  /**
   * Navigate to the filtered posts timeline
   */
  async navigateToTimeline(): Promise<void> {
    this.assertNoActiveSession();
    
    log("[Navigator] Navigating to i/timeline");
    await this.page.goto("https://x.com/i/timeline", { 
      waitUntil: "domcontentloaded",
      timeout: 10000 
    });
    
    await this.page.waitForLoadState("networkidle", { timeout: 15000 });
  }


  /**
   * Open a specific tweet
   */
  async openTweet(url: string): Promise<{ url: string; title: string }> {
    this.assertNoActiveSession();
    
    log(`[Navigator] Opening tweet: ${url}`);
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
    });

    await this.page.waitForSelector("article", { timeout: 15000 });

    // Human-like: variable time "deciding" before opening the tweet
    const { openDelay } = await import("../behavior/profiles");
    await this.page.waitForTimeout(openDelay());

    return {
      url: this.page.url(),
      title: await this.page.title(),
    };
  }

  /**
   * Go back to the i/timeline from a tweet page using browser back button
   * Only allowed when NOT in a review session (review session handles its own navigation)
   */
  async returnToTimeline(): Promise<void> {
    // Don't navigate while a review session owns the browser. During the
    // PROCESSING state (a tweet was opened but the review hasn't started yet) the
    // worker is allowed to navigate back — e.g. when skipping an unreplyable tweet.
    if (sessionManager.isReviewing()) {
      return;
    }

    log("[Navigator] Returning to i/timeline via goBack");
    
    // Use the browser's back button to return to the previous page (i/timeline).
    // This bypasses X.com's server-side redirect that happens with a fresh goto.
    try {
      await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      log("[Navigator] goBack timed out or failed, falling back to direct navigation");
      await this.page.goto("https://x.com/i/timeline", { 
        waitUntil: "domcontentloaded",
        timeout: 15000 
      });
    }

    // Wait for articles to render
    try {
      await this.page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch {
      log("[Navigator] networkidle timed out, continuing with loaded page");
    }

    // Wait for articles to render
    try {
      await this.page.waitForSelector("article", { timeout: 10000 });
    } catch {
      log("[Navigator] Articles did not appear within timeout, continuing anyway");
    }

    // Human-like pause after landing back on the feed
    const delay = Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;
    await this.page.waitForTimeout(delay);
  }

  /**
   * Reload the current page
   */
  async reload(): Promise<void> {
    this.assertNoActiveSession();
    
    log("[Navigator] Reloading page");
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.page.waitForSelector("article", { timeout: 10000 });
  }

  /**
   * Refresh the session by navigating to timeline
   */
  async refreshSession(): Promise<void> {
    this.assertNoActiveSession();
    
    log("[Navigator] Refreshing session");
    await this.navigateToTimeline();
  }

  /**
   * Assert that no active review session is in progress
   * This prevents navigation during review sessions
   */
  private assertNoActiveSession(): void {
    if (sessionManager.isBusy()) {
      throw new Error(
        `Cannot navigate while session is busy (state: ${sessionManager.getState()})`
      );
    }
  }
}

/**
 * Factory function to create a navigator with dependency injection
 */
export function createNavigator(page: Page): BrowserNavigator {
  return new BrowserNavigator(page);
}