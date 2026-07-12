import { Page } from "playwright";
import { sessionManager } from "../core/sessionManager";
import { randomDelayMs } from "../behavior/delays";

function randomDelay(min: number, max: number): number {
  return randomDelayMs(min, max);
}

export async function scrollTimeline(page: Page): Promise<void> {
  // Don't scroll if we're in review mode - the review session owns the browser
  if (sessionManager.isReviewing()) {
    return;
  }

  // Vary the scrolling pattern so it doesn't look robotic. Humans don't scroll
  // the same way every time: sometimes one big scroll, sometimes a couple of
  // small ones, and occasionally a slight scroll-up (re-reading) before continuing.
  const roll = Math.random();

  if (roll < 0.4) {
    // One large scroll
    await page.mouse.wheel(0, 1200 + Math.random() * 800);
    await page.waitForTimeout(randomDelay(800, 2000));
  } else if (roll < 0.8) {
    // Two short scrolls
    for (let i = 0; i < 2; i++) {
      await page.mouse.wheel(0, 400 + Math.random() * 300);
      await page.waitForTimeout(randomDelay(500, 1200));
    }
  } else {
    // Occasionally scroll slightly upward (re-reading) before continuing down
    await page.mouse.wheel(0, -(200 + Math.random() * 200));
    await page.waitForTimeout(randomDelay(600, 1500));
    await page.mouse.wheel(0, 600 + Math.random() * 400);
    await page.waitForTimeout(randomDelay(600, 1500));
  }
}
