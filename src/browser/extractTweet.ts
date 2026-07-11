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

  // Get the timestamp of the first article
  const firstTimeElement = await firstArticle.locator("time").first();
  const firstDatetime = (await firstTimeElement.getAttribute("datetime"))?.trim() ?? "";
  const firstTime = firstDatetime ? new Date(firstDatetime).getTime() : 0;

  // Extract all tweets in the thread (same author, consecutive, within time window)
  const threadTexts: string[] = [];
  const TIME_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

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

    // Check timestamp - if too far from root, stop
    const timeElement = await article.locator("time").first();
    const datetime = (await timeElement.getAttribute("datetime"))?.trim() ?? "";
    if (datetime) {
      const articleTime = new Date(datetime).getTime();
      const timeDiff = Math.abs(articleTime - firstTime);
      if (timeDiff > TIME_WINDOW_MS) {
        // Too far from root tweet, stop collecting
        break;
      }
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