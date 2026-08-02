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
    // just continue to the next cycle. BrowserNavigator.openNotificationFeed()
    // now only ever reports success on a confirmed /i/timeline landing (a
    // profile-page redirect is treated as a failed attempt there instead),
    // so this should never actually see a bare profile URL from that path —
    // kept simple/strict rather than also tolerating one here.
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
            // "X reposted"/"Pinned" label (same signal visitProfile.ts's
            // isRepost/isPinned use). Reposts of your OWN already-replied
            // content resurface here as a fresh-looking notification/timeline
            // entry with the *same* underlying tweet id — without this,
            // that resurfacing looks like a brand-new post to reply to.
            const socialContextEl = article.querySelector('[data-testid="socialContext"]');
            const socialContext = (socialContextEl?.textContent ?? "").toLowerCase();
            const isRepost = socialContext.includes("repost");
            const isPinned = socialContext.includes("pinned");

            // Who actually reposted it — distinct from the article's own
            // author/username below, which for a repost reflects the
            // ORIGINAL tweet's author (X renders a repost as the original
            // tweet's own byline, with this "X reposted" line separate).
            // A blocked handle can repost someone else's (non-blocked)
            // content — without this, only a blocked ORIGINAL author was
            // ever caught, never a blocked REPOSTER reposting someone else.
            // Same extraction pattern as replyingToHandle below: the
            // reposter's name is wrapped in an anchor linking to their
            // profile, so read the handle from that href rather than
            // parsing display-name text.
            let reposterHandle = "";
            if (isRepost && socialContextEl) {
                const reposterAnchor = socialContextEl.querySelector('a[href^="/"]');
                const reposterHref = reposterAnchor?.getAttribute("href") ?? "";
                reposterHandle = reposterHref.replace(/^\//, "").split("/")[0] ?? "";
            }

            const author =
                article.querySelector('[data-testid="User-Name"]')?.textContent?.trim() ?? "";

            // innerText, not textContent — X renders a tweet's manual line
            // breaks as <br> elements, and textContent silently drops them
            // (no \n inserted), collapsing a multi-line story into one
            // run-on string. innerText is layout-aware and preserves them,
            // matching what a person actually sees on the card.
            const text =
                (article.querySelector('[data-testid="tweetText"]') as any)?.innerText?.trim() ?? "";

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

            // Video or GIF — X renders both through the same
            // [data-testid="videoPlayer"] component (a GIF is just a
            // silent, auto-looping video under the hood), so one flag
            // covers both rather than trying to tell them apart.
            const hasVideo = !!article.querySelector('[data-testid="videoPlayer"]');

            // Detect "Replying to @X". Find the innermost (shortest)
            // matching div/span anywhere in the article rather than
            // requiring the article's whole flattened textContent to start
            // with it — the author name/handle/timestamp header renders
            // (and sits in the DOM) before the "Replying to" line on every
            // feed/notification card, so an anchored-at-position-0 check
            // never matches those and silently drops real replies. Scanning
            // for the substring anywhere is the same approach
            // extractThreadReplies.ts already uses for this exact signal.
            const candidates = Array.from(article.querySelectorAll("div, span")) as any[];
            let tightest: any = null;
            let tightestLen = Infinity;
            for (const c of candidates) {
                const t = (c.textContent ?? "").trim();
                if (t.startsWith("Replying to") && t.length < 150 && t.length < tightestLen) {
                    tightest = c;
                    tightestLen = t.length;
                }
            }
            const isReply = !!tightest;
            let replyingToHandle = "";
            if (tightest) {
                const replyAnchor = tightest.querySelector('a[href^="/"]');
                const replyHref = replyAnchor?.getAttribute("href") ?? "";
                replyingToHandle = replyHref.replace(/^\//, "").split("/")[0] ?? "";
            }

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
                hasImage,
                hasVideo,
                isReply,
                isRepost,
                isPinned,
                ...(replyingToHandle ? { replyingToHandle } : {}),
                ...(reposterHandle ? { reposterHandle } : {})
            };
        });
    }, source);

    return tweets.filter(t => t.id && t.text);
}