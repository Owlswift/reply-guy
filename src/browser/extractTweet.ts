import { Page } from "playwright";

export interface TweetDetails {
  author: string;
  handle: string;
  text: string;
  url: string;
}

export async function extractCurrentTweet(
  page: Page
): Promise<TweetDetails> {

  // Wait for article with timeout
  try {
    await page.waitForSelector("article", { timeout: 5000 });
  } catch {
    // If no article found, return empty
    return {
      author: "",
      handle: "",
      text: "",
      url: page.url()
    };
  }

  const article = page.locator("article").first();

  const author =
    (await article
      .locator('[data-testid="User-Name"]')
      .first()
      .textContent({ timeout: 3000 }))?.trim() ?? "";

  // Use first() to avoid strict mode violation
  const text =
    (await article
      .locator('[data-testid="tweetText"]')
      .first()
      .textContent({ timeout: 3000 }))?.trim() ?? "";

  const handleMatch = author.match(/@\w+/);

  return {
    author,
    handle: handleMatch?.[0] ?? "",
    text,
    url: page.url()
  };
}
