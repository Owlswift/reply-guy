import { Page } from "playwright";

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

export async function getTimelineTweets(
  page: Page,
  limit = 30
): Promise<TimelineTweet[]> {
  // Check if already on x.com/home or timeline
  const currentUrl = page.url();
  if (currentUrl.includes("/status/")) {
    // If on a tweet page, go back to home
    console.log("On tweet page, going back to home...");
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  } else if (!currentUrl.includes("x.com/")) {
    console.log("Navigating to x.com/home...");
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
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
    return articles.slice(0, limit).map((article) => {
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

      return {
        id: match?.[1] ?? "",
        author,
        username: handle,
        text,
        url: href.startsWith("http")
          ? href
          : `https://x.com${href.split("?")[0]}`,
        verified: false,
        following: false,
        followsYou: false,
        likes: 0,
        replies: 0,
        reposts: 0
      };
    });
  }, limit);

  return tweets.filter(t => t.id && t.text);
}