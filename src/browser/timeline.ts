import { Page } from "playwright";
import { sessionManager } from "../core/sessionManager";
import { log } from "../utils/logger";

export interface TimelineTweet {
    id: string;
    author: string;
    username: string;
    text: string;
    url: string;
    verified: boolean;
    following: boolean;
    followsYou: boolean;
    likes: number;
    replies: number;
    reposts: number;
}

// Navigate to the filtered posts timeline (for reload functionality)
export async function navigateToHome(page: Page): Promise<void> {
    console.log("Navigating to i/timeline...");
    await page.goto("https://x.com/i/timeline", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15000 });
}

export async function getTimelineTweets(
    page: Page,
    limit = 30
): Promise<TimelineTweet[]> {
  // If in review mode, we should be on a tweet page - don't navigate away!
  if (sessionManager.isReviewing()) {
    // In review mode, we're intentionally on a tweet page
    // Just wait and return empty to avoid interfering with the review
    return [];
  }

  // Extraction is only meaningful on the timeline feed. If we are anywhere else
  // (e.g. an opened tweet conversation page), this is a normal control-flow
  // condition for an autonomous bot — not an error. Skip (return no tweets)
  // instead of throwing or navigating, so the caller can just continue.
  const currentUrl = page.url();
  if (!currentUrl.includes("/i/timeline")) {
    log("Not on timeline. Skipping extraction.");
    return [];
  }

  // Wait for timeline to load
  try {
    await page.waitForSelector("article", { timeout: 10000 });
  } catch {
    // If no articles found, try refreshing
    console.log("Refreshing page...");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 10000 });
  }

  // Give X a moment to render everything
  await page.waitForTimeout(2000);

  const tweets = await page.locator("article").evaluateAll((articles, limit) => {
    // Only keep top-level articles. On a conversation page (/status/), the
    // replies *within* a tweet are themselves <article> elements nested inside
    // the main tweet's article. We exclude any article nested inside another
    // article so we never pick up replies within posts. (Extraction should only
    // ever run on the feed, but this protects against any regression.)
    const topLevelArticles = articles.filter(
      (article) => article.closest("article") === article
    );

    return topLevelArticles.slice(0, limit).map((article) => {
      const author =
        article.querySelector('[data-testid="User-Name"]')?.textContent?.trim() ?? "";

      const text =
        article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? "";

      const anchor = article.querySelector('a[href*="/status/"]');

      const href = anchor?.getAttribute("href") ?? "";

      const match = href.match(/status\/(\d+)/);

      // Extract handle from author
      const handleMatch = author.match(/@\w+/);
      const handle = handleMatch?.[0] ?? "";

      // Extract engagement counts
      const likeButton = article.querySelector('[data-testid="like"]');
      const replyButton = article.querySelector('[data-testid="reply"]');
      const repostButton = article.querySelector('[data-testid="retweet"]');

      const likes = parseInt(likeButton?.textContent?.trim() || "0") || 0;
      const replies = parseInt(replyButton?.textContent?.trim() || "0") || 0;
      const reposts = parseInt(repostButton?.textContent?.trim() || "0") || 0;

       // Check for verified badge
       const verifiedBadge = article.querySelector('[data-testid="icon-verified"]');
       const verified = !!verifiedBadge;

       return {
         id: match?.[1] ?? "",
         author,
         username: handle,
         text,
         url: href.startsWith("http")
           ? href
           : `https://x.com${href.split("?")[0]}`,
         verified,
         following: false,
         followsYou: false,
         likes,
         replies,
         reposts
       };
    });
  }, limit);

  return tweets.filter(t => t.id && t.text);
}