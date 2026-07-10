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

  await page.waitForSelector("article");

  const article = page.locator("article").first();

  const author =
    (await article
      .locator('[data-testid="User-Name"]')
      .first()
      .textContent())?.trim() ?? "";

  // Use first() to avoid strict mode violation
  const text =
    (await article
      .locator('[data-testid="tweetText"]')
      .first()
      .textContent())?.trim() ?? "";

  const handleMatch = author.match(/@\w+/);

  return {
    author,
    handle: handleMatch?.[0] ?? "",
    text,
    url: page.url()
  };
}
