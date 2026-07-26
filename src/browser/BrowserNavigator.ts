import { Page } from "playwright";
import { sessionManager } from "../core/sessionManager";
import { log } from "../utils/logger";
import { getScrollY, setScrollY } from "../timeline/state";

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
        // No notification card to click — the ONLY way this counts as
        // "opened" is if we're already sitting on /i/timeline for some
        // other reason. This used to unconditionally return true either
        // way (a dead if/else — both branches returned the same value),
        // which let checking-for-tweets proceed even with no card ever
        // clicked and no confirmed /i/timeline landing.
        const currentUrl = this.page.url();
        return currentUrl.includes("/i/timeline");
      }

      try {
        await card.first().waitFor({ timeout: 5000 });
        await card.first().click();
      } catch {
        // Click never happened — not a valid "opened" outcome.
        return false;
      }

      // Wait for articles to render after clicking the card
      try {
        await this.page.locator("article").first().waitFor({
          timeout: 10000
        });
      } catch {
        return false;
      }

      // The card doesn't always land on /i/timeline — confirmed live: when
      // only one account has new posts, X deep-links straight to that
      // account's own profile instead. Checking-for-tweets/scrolling must
      // only ever start from a confirmed /i/timeline landing, so treat
      // anything else as a failed attempt (the caller just retries from
      // /notifications next cycle) rather than proceeding on the wrong
      // page. A plain goto("/i/timeline") gets redirected server-side to
      // /home and is never a valid fallback — do not reintroduce that here.
      const landedUrl = this.page.url();
      if (!landedUrl.includes("/i/timeline")) {
        log(`[Navigator] "New post notifications" card landed on ${landedUrl} instead of /i/timeline — treating as not opened.`);
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
   *
   * Returns whether it actually landed on a working feed page. A caller
   * that ignores this (most navigateToTimeline() callsites just `await` it)
   * gets the exact same behavior as before. checkStillOnFeedAfterEmptyScrolls
   * (main-interactive.ts) is the one caller that needs to know it failed —
   * previously it just called this and moved on regardless of outcome, so a
   * blocking modal/dialog could make every single attempt silently no-op
   * and the loop would scroll uselessly for hours between checks instead of
   * ever actually getting unstuck.
   */
  async navigateToTimeline(): Promise<boolean> {
    this.assertNoActiveSession();

    log("[Navigator] Navigating to notifications (i/timeline direct goto is rejected by X)");
    await this.goToNotificationFeedDirect();

    if (await this.landedOnWorkingFeed()) {
      return true;
    }

    // Didn't land cleanly — a blocking modal/popup/overlay (a "something
    // went wrong" dialog, a confirmation prompt, a cookie/consent sheet,
    // etc.) is the most likely reason the click-through above silently did
    // nothing. Try to clear it and retry once before giving up.
    const dismissed = await this.dismissBlockingOverlay();
    if (dismissed) {
      log("[Navigator] Dismissed a blocking overlay — retrying navigation to notifications.");
      await this.goToNotificationFeedDirect();
    }

    return this.landedOnWorkingFeed();
  }

  /**
   * Whether the page actually landed somewhere usable after a navigation
   * attempt — a feed URL AND actual article content, not just a URL match
   * (a modal can sit on top of /notifications and still count as "on the
   * right page" by URL alone).
   */
  private async landedOnWorkingFeed(): Promise<boolean> {
    if (!this.isOnFeedPage()) return false;
    try {
      await this.page.waitForSelector("article", { timeout: 15000 });
      return true;
    } catch {
      log("[Navigator] On a feed URL but no articles rendered — treating as not landed.");
      return false;
    }
  }

  /**
   * Look for a modal, popup, confirmation dialog, or overlay sitting on top
   * of the page and blocking interaction, and try to dismiss it. Returns
   * whether something was found (regardless of whether dismissal actually
   * worked — the caller re-checks landedOnWorkingFeed() either way).
   */
  private async dismissBlockingOverlay(): Promise<boolean> {
    const overlay = this.page.locator(
      '[role="dialog"], [data-testid="mask"], [data-testid="sheetDialog"], [aria-modal="true"]'
    ).first();

    const present = await overlay.isVisible().catch(() => false);
    if (!present) return false;

    log("[Navigator] Blocking overlay detected — attempting to dismiss.");

    // Escape closes the large majority of X's dialogs/sheets/toasts.
    await this.page.keyboard.press("Escape").catch(() => {});
    if (!(await overlay.isVisible().catch(() => false))) return true;

    // Explicit close button next (X's own close icon, or a generic one).
    const closeButton = this.page.locator(
      '[data-testid="app-bar-close"], button[aria-label="Close"], div[aria-label="Close"]'
    ).first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click().catch(() => {});
      if (!(await overlay.isVisible().catch(() => false))) return true;
    }

    // Last resort: click the dimmed backdrop behind the dialog, which
    // dismisses most sheet/modal overlays the same way clicking outside
    // them would.
    const backdrop = this.page.locator('[data-testid="mask"]').first();
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ position: { x: 5, y: 5 } }).catch(() => {});
    }

    return true;
  }


  /**
   * Open a specific tweet.
   *
   * Saves the current scroll position (timeline/state.ts) before navigating
   * away, so goBack()/returnToTimeline() can restore it afterward regardless
   * of whether this tweet ends up replied to or skipped. This used to be the
   * caller's job (main-interactive.ts saved it manually right before calling
   * this) — centralized here instead so every caller gets it automatically,
   * including ones that were missing it entirely (workers/browserWorker.ts
   * called this with no scroll-save at all, which would have restored
   * whatever main-interactive.ts's own PHASE 3 had last saved instead of
   * this worker's actual position).
   */
  async openTweet(url: string): Promise<{ url: string; title: string }> {
    this.assertNoActiveSession();

    const currentScrollY = await this.page.evaluate(() => window.scrollY).catch(() => 0);
    setScrollY(currentScrollY);

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

    await this.restoreScrollPosition();

    // Human-like pause after landing back
    const delay = Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;
    await this.page.waitForTimeout(delay);
  }

  /**
   * Restore the scroll position saved (timeline/state.ts's setScrollY,
   * called right before openTweet()) before this tweet was opened.
   *
   * page.goBack() alone does NOT reliably restore it on X — X's SPA
   * re-renders the feed route on history restoration rather than doing a
   * true browser bfcache restore, so scroll silently resets to the top
   * regardless of what the browser's own back button would normally do.
   *
   * This used to only run after a successful reply post (main-interactive.ts
   * PHASE 5), never after any of the many SKIP branches (blocked handle,
   * stale, image gate, generation failure, etc.) that also call goBack() or
   * returnToTimeline() — and skips vastly outnumber successful replies in a
   * real run. The result: nearly every skip silently reset scroll to the
   * top, so the next watch cycle re-scanned the same already-replied
   * notifications from scratch instead of continuing from where it left
   * off — looking like the whole loop "started over" on every skip.
   * Centralizing it here means every caller of goBack()/returnToTimeline()
   * gets it automatically, instead of each call site having to remember to
   * restore it individually.
   */
  private async restoreScrollPosition(): Promise<void> {
    const savedScrollY = getScrollY();
    if (savedScrollY <= 0) return;

    await this.page.evaluate((y) => window.scrollTo(0, y), savedScrollY).catch(() => {});

    // Read back what the scroll ACTUALLY landed on rather than assuming the
    // target was reached. X's feed is virtualized/lazy-loaded — right after
    // goBack(), only a small batch of content has re-rendered (we only wait
    // for the FIRST article to appear, not for the page to regrow to its
    // previous scrollable height), so a big jump silently clamps to whatever
    // the currently-loaded height allows.
    let actualScrollY = await this.page.evaluate(() => window.scrollY).catch(() => null);

    if (actualScrollY !== null && Math.abs(actualScrollY - savedScrollY) > 50) {
      // Clamped. A single instant jump can't out-run a virtualized list
      // that hasn't rendered that deep yet — the browser physically has
      // nowhere to scroll TO. Scroll incrementally instead (like a human
      // would), pausing between steps so X's lazy-loading has a chance to
      // grow the page, re-attempting the direct jump as it goes.
      //
      // Without this, every reply/skip that clamps forces the NEXT watch
      // cycle to re-walk the entire already-handled stretch of the feed
      // from scratch to get back to fresh content — several minutes of
      // "All visible notifications already replied, scrolling for older
      // posts" on every single cycle, which is exactly what looked like
      // Echo "just scrolling and scrolling without ever replying."
      const MAX_INCREMENTAL_STEPS = 40;
      const CLOSE_ENOUGH_PX = 150;

      for (let i = 0; i < MAX_INCREMENTAL_STEPS; i++) {
        const current = await this.page.evaluate(() => window.scrollY).catch(() => null);
        if (current === null || current >= savedScrollY - CLOSE_ENOUGH_PX) break;

        await this.page.evaluate(() => window.scrollBy(0, 2000)).catch(() => {});
        await this.page.waitForTimeout(350);
        // Re-attempt the direct jump too, in case enough has now loaded.
        await this.page.evaluate((y) => window.scrollTo(0, y), savedScrollY).catch(() => {});
      }

      actualScrollY = await this.page.evaluate(() => window.scrollY).catch(() => null);
    }

    if (actualScrollY !== null && Math.abs(actualScrollY - savedScrollY) > 50) {
      log(`[Navigator] Scroll restore still short after incremental recovery — wanted ${savedScrollY}px, landed on ${actualScrollY}px.`);
    } else {
      log(`[Navigator] Restored scroll position to ${actualScrollY ?? savedScrollY}px`);
    }
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

    await this.restoreScrollPosition();

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