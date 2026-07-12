import { Page } from "playwright";
import { openDelay } from "../behavior/profiles";

export async function openTweet(page: Page, url: string) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForSelector("article", { timeout: 15000 });

  // Human-like: variable time "deciding" before opening the tweet
  await page.waitForTimeout(openDelay());

  return {
    url: page.url(),
    title: await page.title(),
  };
}

export interface ExtractedTweet {
  author: string;
  handle: string;
  text: string;
  url: string;
}

export async function extractCurrentTweet(page: Page): Promise<ExtractedTweet> {
  // Wait for the tweet content to be available
  await page.waitForSelector('[data-testid="tweetText"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="User-Name"]', { timeout: 10000 });

  // Extract author handle (includes @)
  const authorElement = page.locator('[data-testid="User-Name"]');
  const authorText = await authorElement.textContent();
  
  // Extract the handle (usually the first line or contains @)
  const handleMatch = authorText?.match(/@(\w+)/);
  const handle = handleMatch ? `@${handleMatch[1]}` : "";
  
  // Extract author name (usually the first part before the handle)
  const author = (authorText?.split('@')[0] ?? "").trim();

  // Extract tweet text
  const text = (await page.locator('[data-testid="tweetText"]').textContent())?.trim() ?? "";

  // Get current URL
  const url = page.url();

  return {
    author,
    handle,
    text,
    url,
  };
}