import { Page } from "playwright";
import { TimelineTweet } from "../types/tweet";

export type TweetSourceType = "notifications" | "timeline" | "watchlist";

export async function extractTweets(
    page: Page,
    source: TweetSourceType = "timeline"
): Promise<TimelineTweet[]> {

    // For notifications source, only extract from the i/timeline page
    if (source === "notifications") {
        const currentUrl = page.url();
        if (!currentUrl.includes("/i/timeline")) {
            console.log(`Not on i/timeline page (${currentUrl}), navigating...`);
            await page.goto("https://x.com/i/timeline", { waitUntil: "domcontentloaded" });
        }
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

    const tweets = await page.locator("article").evaluateAll((articles, source) => {
        return articles.map((article) => {
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
                reposts,
                source
            };
        });
    }, source);

    return tweets.filter(t => t.id && t.text);
}