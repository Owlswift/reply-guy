import { Page } from "playwright";
import { expandTweet } from "./expandTweet";

export interface TweetDetails {
  author: string;
  handle: string;
  text: string;
  fullText: string;
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
      fullText: "",
      url: page.url()
    };
  }

  // Expand any "Show more" links first
  await expandTweet(page);

  const articles = await page.locator("article").all();

  if (articles.length === 0) {
    return {
      author: "",
      handle: "",
      text: "",
      fullText: "",
      url: page.url()
    };
  }

  // Get the author of the first article (root tweet)
  const firstArticle = articles[0];
  if (!firstArticle) {
    return {
      author: "",
      handle: "",
      text: "",
      fullText: "",
      url: page.url()
    };
  }

  const firstAuthor =
    (await firstArticle
      .locator('[data-testid="User-Name"]')
      .first()
      .textContent({ timeout: 3000 }))?.trim() ?? "";

  const handleMatch = firstAuthor.match(/@\w+/);
  const rootHandle = handleMatch?.[0] ?? "";

  // Extract all tweets in the thread (same author, consecutive)
  const threadTexts: string[] = [];

  for (const article of articles) {
    const author =
      (await article
        .locator('[data-testid="User-Name"]')
        .first()
        .textContent({ timeout: 3000 }))?.trim() ?? "";

    // Check if this is the same author (part of the thread)
    const authorHandleMatch = author.match(/@\w+/);
    const authorHandle = authorHandleMatch?.[0] ?? "";

    if (authorHandle !== rootHandle) {
      // Different author, stop collecting thread
      break;
    }

    // Use first() to avoid strict mode violation
    const text =
      (await article
        .locator('[data-testid="tweetText"]')
        .first()
        .textContent({ timeout: 3000 }))?.trim() ?? "";

    if (text) {
      threadTexts.push(text);
    }
  }

  // Join thread texts with blank lines
  const fullText = threadTexts.join("\n\n");

  // Get the first tweet text for backward compatibility
  const firstText = threadTexts[0] ?? "";

  return {
    author: firstAuthor,
    handle: rootHandle,
    text: firstText,
    fullText,
    url: page.url()
  };
}