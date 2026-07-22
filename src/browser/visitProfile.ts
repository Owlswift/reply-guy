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
// up. Bounds the cost of a single visit — if a handle posted more than
// this many originals since the last check, we just take the newest ones
// and move on.
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

interface ScanOptions {
  maxArticles: number;
  maxAgeMs: number;
  // If set, stop (without including it) once a chronological article with
  // this id is reached — the periodic "what's new since last check" case.
  // If null, scan every chronological article within maxAgeMs regardless
  // of a cursor — the "catch up on anything within this window" case.
  stopAtId: string | null;
}

/**
 * Shared scan loop: scroll progressively through a profile's Posts tab,
 * classifying each article (repost/pinned/reply/original) and collecting
 * originals per the given options. Reposts and pinned tweets are
 * identified by X's own [data-testid="socialContext"] label ("X
 * reposted", "Pinned"), verified against a live profile. Replies-to-others
 * don't appear on the default Posts tab at all, so no separate reply
 * check is needed there — only a defensive check for a self-thread
 * continuation showing "Replying to".
 *
 * A pinned tweet is included if it's actually fresh (under maxAgeMs)
 * rather than always skipped — pinning doesn't imply "old evergreen
 * post," an author can pin something they posted an hour ago. It's just
 * never allowed to drive the cursor/age-cutoff decisions, since its
 * position (always slot 0) doesn't reflect chronological order and using
 * it for that would permanently block the scan on every future visit.
 *
 * Scrolls progressively while scanning — the timeline is virtualized, so
 * articles beyond what's initially mounted only appear as you scroll.
 */
async function scanProfile(
  page: Page,
  handle: string,
  options: ScanOptions
): Promise<{ found: ProfileOriginalTweet[]; newestTweetId: string | null }> {
  await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded" });

  try {
    await page.waitForSelector("article", { timeout: 10_000 });
  } catch {
    // Empty/suspended/rate-limited profile — nothing to do this cycle.
    return { found: [], newestTweetId: null };
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

      const isChronological = !info.isPinned && !info.isRepost;

      if (isChronological) {
        if (newestTweetId === null) {
          newestTweetId = info.id;
        }
        if (options.stopAtId && info.id === options.stopAtId) {
          stop = true;
          break;
        }
        if (info.datetime && Date.now() - new Date(info.datetime).getTime() > options.maxAgeMs) {
          // Profiles list posts newest-first, so once we hit a
          // chronological one over the age limit, everything after it
          // (in chronological terms) is even older — stop.
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
          (!info.datetime || Date.now() - new Date(info.datetime).getTime() > options.maxAgeMs);

        if (!pinnedTooOld) {
          found.push({
            id: info.id,
            url: info.href.startsWith("http") ? info.href : `https://x.com${info.href.split("?")[0]}`,
            text: info.text,
            author: `@${handle}`,
          });
        }
      }

      if (scannedCount >= options.maxArticles) {
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

  return { found, newestTweetId };
}

/**
 * Visit a profile's Posts tab and collect original posts newer than
 * lastSeenTweetId — the periodic "what's new since last check" use case
 * (Priority Handles Worker).
 */
export async function visitProfileForNewOriginals(
  page: Page,
  username: string,
  lastSeenTweetId: string | null
): Promise<ProfileVisitResult> {
  const handle = username.replace(/^@/, "");
  const { found, newestTweetId } = await scanProfile(page, handle, {
    maxArticles: MAX_ARTICLES_TO_SCAN,
    maxAgeMs: MAX_AGE_MS,
    stopAtId: lastSeenTweetId,
  });
  // found is newest-first (scan order); reverse so callers enqueue in the
  // order the tweets were actually posted.
  return { newOriginals: found.reverse(), newestTweetId };
}

/**
 * Collect every original post from a profile within maxAgeMs, regardless
 * of any previously-seen cursor — the "catch up on anything in this
 * window" use case (manual catch-up command). Callers are expected to
 * de-duplicate against already-replied tweets themselves (e.g. via
 * hasReplied()), since this returns everything in the window, not just
 * what's new.
 */
export async function scanProfileWithinWindow(
  page: Page,
  username: string,
  maxAgeMs: number,
  maxArticles: number = MAX_ARTICLES_TO_SCAN
): Promise<ProfileOriginalTweet[]> {
  const handle = username.replace(/^@/, "");
  const { found } = await scanProfile(page, handle, {
    maxArticles,
    maxAgeMs,
    stopAtId: null,
  });
  return found.reverse();
}
