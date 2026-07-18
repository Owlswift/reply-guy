import { Page } from "playwright";
import { TimelineTweet } from "../types/tweet";
import { log } from "../utils/logger";
import { expandTweet } from "./expandTweet";

export type TweetSourceType = "notifications" | "timeline" | "watchlist";

export async function extractTweets(
    page: Page,
    source: TweetSourceType = "timeline"
): Promise<TimelineTweet[]> {

    // Extraction is only meaningful on a feed page. If we are anywhere else
    // (e.g. an opened tweet conversation page, or a logged-out/error page), this
    // is a normal control-flow condition for an autonomous bot — not an error.
    // Skip silently (return no tweets) instead of throwing, so the caller can
    // just continue to the next cycle.
    const url = page.url();
    const onTimeline =
        url.includes("/i/timeline") ||
        url.includes("/home") ||
        url.includes("/notifications");

    if (!onTimeline) {
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

    // Expand "Show more" so scoring/decisions see full text, not the
    // truncated preview — same helper the reply-drafting path already uses.
    await expandTweet(page);

    const tweets = await page.locator("article").evaluateAll((articles, source) => {
        // Defense in depth: only keep top-level articles. On a conversation page the
        // replies *within* a tweet are themselves <article> elements nested inside the
        // main tweet's article. We exclude any article nested inside another so we
        // never pick up replies within posts. (This should never trigger because we
        // only extract from the feed, but it protects against any future regression.)
        const topLevelArticles = articles.filter(
            (article) => article.closest("article") === article
        );

        return topLevelArticles.map((article) => {
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

            // Check for image(s) — same selector extractCurrentTweet.ts uses
            // once a tweet is opened, so we can filter image tweets out
            // before ever navigating to them.
            const hasImage = !!article.querySelector('[data-testid="tweetPhoto"]');

            // Extract timestamp. When this tweet quote-tweets or previews
            // another one, the article contains two <time> elements and
            // their DOM order isn't reliable (verified: a plain quote-tweet
            // puts the quoted tweet's older <time> first, but a "show this
            // thread" preview card puts the newer one first). What IS
            // consistent: this tweet's own <time> is wrapped in an
            // <a role="link"> (a direct permalink anchor), while a nested/
            // quoted tweet's <time> is wrapped in a <div role="link">
            // (the quote-card container) — walk up from each <time> to its
            // closest role="link" ancestor and use the tag to tell them apart.
            const times: any[] = Array.from(article.querySelectorAll("time"));
            let ownTime: any = null;
            for (const t of times) {
                let el: any = t.parentElement;
                let roleLinkTag: string | null = null;
                while (el && el !== article) {
                    if (el.getAttribute("role") === "link") {
                        roleLinkTag = el.tagName;
                        break;
                    }
                    el = el.parentElement;
                }
                if (roleLinkTag === "A") {
                    ownTime = t;
                    break;
                }
            }
            const timeElement = ownTime ?? times[0] ?? null;
            const datetime = timeElement?.getAttribute("datetime") ?? "";
            const createdAt = datetime ? new Date(datetime) : new Date();

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
                source,
                createdAt,
                hasImage
            };
        });
    }, source);

    return tweets.filter(t => t.id && t.text);
}