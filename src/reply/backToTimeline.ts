import { Page } from "playwright";
import { sessionManager } from "../core/sessionManager";

// Random delay between min and max milliseconds
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function backToTimeline(page: Page): Promise<void> {
  // Don't navigate if we're busy (reviewing or posting) - the review session owns the browser
  if (sessionManager.isBusy()) {
    return;
  }

  await page.goto("https://x.com/i/timeline", { waitUntil: "domcontentloaded", timeout: 10000 });

  await page.waitForLoadState("networkidle", { timeout: 15000 });

  await page.waitForTimeout(randomDelay(2000, 4000));
}
