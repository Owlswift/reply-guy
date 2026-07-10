import { Page } from "playwright";

// Random delay between min and max milliseconds
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function typeReply(page: Page, reply: string): Promise<void> {
  const box = page.locator(
    '[data-testid="tweetTextarea_0"]'
  );

  // Type with human-like delays
  // Random typing speed (15-60ms between keystrokes)
  // Occasional brief pauses between words
  const words = reply.split(" ");
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word) {
      await page.keyboard.type(word, {
        delay: randomDelay(15, 60),
      });
    }
    
    // Add space after word (except last)
    if (i < words.length - 1) {
      // Occasional pause between words (10% chance)
      if (Math.random() < 0.1) {
        await page.waitForTimeout(randomDelay(200, 500));
      }
      await page.keyboard.press("Space");
    }
  }
}