import { Page } from "playwright";

// Random delay between min and max milliseconds
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function backToTimeline(page: Page): Promise<void> {
  await page.goBack();

  await page.waitForLoadState("networkidle", { timeout: 15000 });

  await page.waitForTimeout(randomDelay(2000, 4000));
}
