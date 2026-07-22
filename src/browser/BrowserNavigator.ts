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

      // Don't wait for networkidle — X.com's SPA never truly goes idle
      // (persistent polling/websocket traffic), so this always burned its
      // timeout for no benefit. The article-selector wait below is the
      // real readiness signal.

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

      // Wait for articles to render after clicking the card
      try {
        await this.page.locator("article").first().waitFor({
          timeout: 10000
        });
      } catch {
        return false;
      }

      return true;
    } catch (error) {
      log(`[Navigator] Failed to open notification feed: ${error}`);
      return false;
    }
  }

  /**
   * The actual working way to get back to the feed when goBack() isn't an
   * option: go to /notifications and click the "New post notifications
   * for..." card, exactly like openNotificationFeed() does on startup. A
   * plain goto("/i/timeline") gets redirected server-side to /home and is
   * never a valid fallback — do not reintroduce that here.
   */
  private async goToNotificationFeedDirect(): Promise<void> {
    await this.page.goto("https://x.com/notifications", {
      waitUntil: "domcontentloaded",
      timeout: 15000
    }).catch(() => {});

    try {
      await this.page.locator("article").first().waitFor({ timeout: 15000 });
    } catch {
      return;
    }

    const card = this.page.locator("article").filter({
      has: this.page.getByText(/^New post notifications for/)
    });

    if (await card.count() === 0) {
      return;
    }

    try {
      await card.first().waitFor({ timeout: 5000 });
      await card.first().click();
    } catch {
      // Card didn't click — staying on /notifications is still fine.
    }
  }

  /**
   * Navigate to the filtered posts timeline.
   *
   * X rejects/aborts a direct goto("/i/timeline") outright (ERR_ABORTED) —
   * this used to do exactly that and would loop forever failing every 5s
   * whenever refreshSession() called it. Go through /notifications and
   * click the "New post notifications for..." card instead, exactly like
   * openNotificationFeed() and returnToTimeline() already do.
   */
  async navigateToTimeline(): Promise<void> {
    this.assertNoActiveSession();

    log("[Navigator] Navigating to notifications (i/timeline direct goto is rejected by X)");
    await this.goToNotificationFeedDirect();

    // Wait for articles to render — don't wait for networkidle because
    // X.com maintains persistent WebSocket connections for real-time feed
    // updates, meaning network idle is never truly reached on the feed page.
    try {
      await this.page.waitForSelector("article", { timeout: 15000 });
    } catch {
      log("[Navigator] No articles found on timeline, continuing anyway");
    }
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
   * Go back one page in browser history using the back button.
   * This is the preferred way to return to notifications after opening a tweet,
   * because X.com's server redirects /i/timeline to /home if you use goto.
   */
  async goBack(): Promise<void> {
    log("[Navigator] Going back in history");
    try {
      await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      log("[Navigator] goBack timed out or failed");
    }

    // Don't wait for networkidle — X.com's SPA never truly goes idle
    // (persistent polling/websocket traffic for the feed), so this always
    // burned its full timeout for no benefit. isOnFeedPage() (URL check)
    // below is the actual reliability signal.

    // page.goBack() can resolve without throwing even when there's no
    // history entry to go back to (or X's SPA history is out of sync with
    // a real navigation) — it silently no-ops and leaves the page wherever
    // it already was. Verify we actually landed on a feed page and force
    // a direct navigation if not, otherwise every caller downstream would
    // loop forever thinking there's simply nothing new to find.
    if (!this.isOnFeedPage()) {
      log(`[Navigator] goBack landed on unexpected page (${this.page.url()}) — forcing navigation to notifications`);
      await this.page.goto("https://x.com/notifications", {
        waitUntil: "domcontentloaded",
        timeout: 15000
      }).catch(() => {});
    }

    try {
      await this.page.waitForSelector("article", { timeout: 10000 });
    } catch {
      log("[Navigator] Articles did not appear within timeout, continuing anyway");
    }

    // Human-like pause after landing back
    const delay = Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;
    await this.page.waitForTimeout(delay);
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
      log("[Navigator] goBack timed out or failed, falling back to the notifications feed");
      await this.goToNotificationFeedDirect();
    }

    // Don't wait for networkidle — see goBack() above for why.

    // Same silent-no-op risk as goBack() above — verify and self-correct.
    // X's server redirects a plain goto("/i/timeline") to /home, so that's
    // never a valid fallback here — go through /notifications instead,
    // exactly like openNotificationFeed() does on startup.
    if (!this.isOnFeedPage()) {
      log(`[Navigator] returnToTimeline landed on unexpected page (${this.page.url()}) — going to notifications instead`);
      await this.goToNotificationFeedDirect();
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
   * Whether the current page is a recognized feed page (timeline, home, or
   * notifications) as opposed to a stray tweet/conversation page or
   * something goBack() left us on unexpectedly.
   */
  private isOnFeedPage(): boolean {
    const url = this.page.url();
    return url.includes("/i/timeline") || url.includes("/home") || url.includes("/notifications");
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