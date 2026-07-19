import { Page } from "playwright";

export interface ProfileOriginalTweet {
  id: string;
  url: string;
  text: string;
  author: string;
}

export interface ProfileVisitResult {
  newOriginals: ProfileOriginalTweet[];
  newestTweetId: string | null;
}

// How many articles from the top of the profile to inspect before giving
// up on catching all the way up to lastSeenTweetId. Bounds the cost of a
// single visit — if a handle posted more than this many originals since
// the last check, we just take the newest ones and move on.
//
// Reposts and pinned tweets don't count toward "found" or advance the
// cursor, but they DO consume scan slots — a heavy reposter can put a
// dozen+ reposts in a row before their next original post. Verified
// live: one tracked account had 15 consecutive reposts before her next
// original story. 25 gives real margin above that.
const MAX_ARTICLES_TO_SCAN = 25;

// X virtualizes the profile timeline — only articles near the current
// scroll position are actually mounted in the DOM, regardless of
// MAX_ARTICLES_TO_SCAN. Verified live: a fresh page load only had ~8
// articles mounted; reaching article 15 required multiple scroll steps.
// Bounds how many scroll attempts we'll make chasing MAX_ARTICLES_TO_SCAN.
const MAX_SCROLL_STEPS = 15;

// Same cutoff as the notification-based skip gate (scoreTweet.ts) — a post
// this old isn't worth replying to regardless of source.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface ArticleInfo {
  isRepost: boolean;
  isPinned: boolean;
  isReply: boolean;
  href: string;
  id: string | null;
  text: string;
  datetime: string | null;
}

async function readArticle(article: ReturnType<Page["locator"]>): Promise<ArticleInfo> {
  return article.evaluate((el: any) => {
    const socialContext = (el.querySelector('[data-testid="socialContext"]')?.textContent ?? "").toLowerCase();
    const isRepost = socialContext.includes("repost");
    const isPinned = socialContext.includes("pinned");
    const isReply = (el.textContent ?? "").trim().startsWith("Replying to");
    const anchor = el.querySelector('a[href*="/status/"]');
    const href = anchor?.getAttribute("href") ?? "";
    const idMatch = href.match(/status\/(\d+)/);
    const text = el.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? "";

    // This tweet's own <time>, not a nested quote-tweet's — same
    // role="link" heuristic as extractTweet.ts (an <a role="link">
    // wraps this tweet's own timestamp; a <div role="link"> wraps a
    // quote-card's).
    const times: any[] = Array.from(el.querySelectorAll("time"));
    let datetime: string | null = null;
    for (const t of times) {
      let node: any = t.parentElement;
      let roleLinkTag: string | null = null;
      while (node && node !== el) {
        if (node.getAttribute("role") === "link") {
          roleLinkTag = node.tagName;
          break;
        }
        node = node.parentElement;
      }
      if (roleLinkTag === "A") {
        datetime = t.getAttribute("datetime");
        break;
      }
    }
    if (!datetime) datetime = times[0]?.getAttribute("datetime") ?? null;

    return { isRepost, isPinned, isReply, href, id: idMatch?.[1] ?? null, text, datetime };
  });
}

/**
 * Visit a profile's Posts tab and collect original posts — not reposts,
 * not replies, and not stale pins — newer than lastSeenTweetId.
 *
 * Reposts and pinned tweets are identified by X's own
 * [data-testid="socialContext"] label ("X reposted", "Pinned"), verified
 * against a live profile. Replies-to-others don't appear on the default
 * Posts tab at all, so no separate reply check is needed there — only a
 * defensive check for a self-thread continuation showing "Replying to".
 *
 * A pinned tweet is included if it's actually fresh (under the age cutoff)
 * rather than always skipped — pinning doesn't imply "old evergreen post,"
 * an author can pin something they posted an hour ago. It's just never
 * allowed to drive the lastSeenTweetId cursor, since its position (always
 * slot 0) doesn't reflect chronological order and using it as the cursor
 * would permanently block the scan on every future visit.
 *
 * Scrolls progressively while scanning — the timeline is virtualized, so
 * articles beyond what's initially mounted only appear as you scroll.
 */
export async function visitProfileForNewOriginals(
  page: Page,
  username: string,
  lastSeenTweetId: string | null
): Promise<ProfileVisitResult> {
  const handle = username.replace(/^@/, "");

  await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded" });

  try {
    await page.waitForSelector("article", { timeout: 10_000 });
  } catch {
    // Empty/suspended/rate-limited profile — nothing to do this cycle.
    return { newOriginals: [], newestTweetId: null };
  }
  await page.waitForTimeout(1500);

  const found: ProfileOriginalTweet[] = [];
  const seenIds = new Set<string>();
  let newestTweetId: string | null = null;
  let scannedCount = 0;
  let stop = false;
  let previousScrollY = -1;

  for (let step = 0; step < MAX_SCROLL_STEPS && !stop; step++) {
    const articles = await page.locator("article").all();

    for (const article of articles) {
      if (stop) break;

      const info = await readArticle(article);
      if (!info.id || seenIds.has(info.id)) continue;
      seenIds.add(info.id);
      scannedCount++;

      // A pinned tweet sits at position 0 forever, regardless of when it
      // was actually posted — it can be brand new or years old, and
      // either way it does NOT reflect chronological order relative to
      // what's below it. Reposts have the same problem (a years-old
      // tweet can get reposted today). Only a genuine chronological post
      // can safely be used as the "have I already scanned past
      // everything new" cursor or trigger the age-based cutoff.
      const isChronological = !info.isPinned && !info.isRepost;

      if (isChronological) {
        if (newestTweetId === null) {
          newestTweetId = info.id;
        }
        if (lastSeenTweetId && info.id === lastSeenTweetId) {
          stop = true;
          break;
        }
        if (info.datetime && Date.now() - new Date(info.datetime).getTime() > MAX_AGE_MS) {
          // Profiles list posts newest-first, so once we hit a
          // chronological one over 12hr old, everything after it (in
          // chronological terms) is even older — stop.
          stop = true;
          break;
        }
      }

      if (!info.isRepost && !info.isReply && info.text) {
        // Pinned tweets are judged on their own merits (just the age
        // check) instead of being unconditionally skipped — a pin can be
        // a genuinely fresh post the author wants visible.
        const pinnedTooOld =
          info.isPinned &&
          (!info.datetime || Date.now() - new Date(info.datetime).getTime() > MAX_AGE_MS);

        if (!pinnedTooOld) {
          found.push({
            id: info.id,
            url: info.href.startsWith("http") ? info.href : `https://x.com${info.href.split("?")[0]}`,
            text: info.text,
            author: `@${handle}`,
          });
        }
      }

      if (scannedCount >= MAX_ARTICLES_TO_SCAN) {
        stop = true;
        break;
      }
    }

    if (stop) break;

    const scrollY = await page.evaluate(() => window.scrollY);
    if (scrollY === previousScrollY) break; // reached the bottom, nothing more to load
    previousScrollY = scrollY;
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(700);
  }

  // found is newest-first (scan order); reverse so callers enqueue in the
  // order the tweets were actually posted.
  return { newOriginals: found.reverse(), newestTweetId };
}
