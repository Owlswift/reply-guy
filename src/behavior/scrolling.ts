import { Page } from "playwright";
import { randomDelayMs } from "./delays";

export async function randomScroll(page: Page): Promise<void> {
  const distance = 400 + Math.random() * 1000;
  await page.mouse.wheel(0, distance);
}

export async function humanScroll(page: Page): Promise<void> {
  // Multiple small scrolls like a human
  const scrollCount = Math.floor(Math.random() * 3) + 1;
  
  for (let i = 0; i < scrollCount; i++) {
    await randomScroll(page);
    await page.waitForTimeout(randomDelayMs(600, 1800));
  }
}