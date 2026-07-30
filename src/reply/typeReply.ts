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
  // Random typing speed (40-120ms between keystrokes) — slower than a
  // realistic fast typist on purpose, so the reply box stays visibly open
  // for a bit rather than filling almost instantly.
  // Occasional brief pauses between words
  const words = reply.split(" ");
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word) {
      await page.keyboard.type(word, {
        delay: randomDelay(40, 120),
      });
    }

    // Add space after word (except last)
    if (i < words.length - 1) {
      // Occasional pause between words (20% chance)
      if (Math.random() < 0.2) {
        await page.waitForTimeout(randomDelay(250, 600));
      }
      await page.keyboard.press("Space");
    }
  }
}