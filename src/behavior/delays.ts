import { Page } from "playwright";

// Random delay between min and max milliseconds
export function randomDelayMs(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function randomDelay(
  page: Page,
  min: number,
  max: number
): Promise<void> {
  const delay = randomDelayMs(min, max);
  await page.waitForTimeout(delay);
}