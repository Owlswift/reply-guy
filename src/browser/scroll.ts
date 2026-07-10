import { Page } from "playwright";

// Random delay between min and max milliseconds
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function scrollTimeline(page: Page): Promise<void> {
  // Human-like scrolling: multiple small scrolls
  const scrollCount = Math.floor(Math.random() * 3) + 1;
  
  for (let i = 0; i < scrollCount; i++) {
    await page.mouse.wheel(0, 500 + Math.random() * 400);
    
    await page.waitForTimeout(randomDelay(600, 1800));
  }
}