import { Page } from "playwright";
import { sessionManager } from "../core/sessionManager";

// Random delay between min and max milliseconds
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function backToTimeline(page: Page): Promise<void> {
  // Don't navigate while a review session owns the browser. During the
  // PROCESSING state (a tweet was opened but the review hasn't started yet) the
  // worker is allowed to navigate back — e.g. when skipping an unreplyable tweet.
  if (sessionManager.isReviewing()) {
    return;
  }

  await page.goto("https://x.com/i/timeline", { waitUntil: "domcontentloaded", timeout: 10000 });

  await page.waitForLoadState("networkidle", { timeout: 15000 });

  await page.waitForTimeout(randomDelay(2000, 4000));
}
