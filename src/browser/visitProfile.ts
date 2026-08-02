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
    // innerText, not textContent — X renders manual line breaks as <br>
    // elements, which textContent silently drops (extractTweet.ts's
    // readArticle has the full explanation).
    const text = el.querySelector('[data-testid="tweetText"]')?.innerText?.trim() ?? "";

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
/**
 * Invoked once per qualifying original post, in scan order (newest-first),
 * the moment it's found — awaited before the scroll continues. This is
 * what lets a caller open and fully handle each post immediately instead
 * of collecting a batch and processing it afterward (see
 * scanProfileWithinWindow).
 *
 * Returning `true` stops the scan for this handle right here — the rest of
 * the window's posts for this same handle are never even opened. Used by
 * runCatchup.ts's catchup_stories path to reply to at most one post per
 * handle instead of every qualifying post in the window. Returning
 * `undefined`/void (every other caller) continues scanning as before —
 * additive, not a breaking change.
 */
type OnOriginalPost = (post: ProfileOriginalTweet) => Promise<void | true>;

async function scanProfile(
  page: Page,
  handle: string,
  options: ScanOptions,
  onOriginalPost: OnOriginalPost
): Promise<{ newestTweetId: string | null }> {
  await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded" });

  try {
    await page.waitForSelector("article", { timeout: 10_000 });
  } catch {
    // Empty/suspended/rate-limited profile — nothing to do this cycle.
    return { newestTweetId: null };
  }
  await page.waitForTimeout(1500);

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
          const result = await onOriginalPost({
            id: info.id,
            url: info.href.startsWith("http") ? info.href : `https://x.com${info.href.split("?")[0]}`,
            text: info.text,
            author: `@${handle}`,
          });
          if (result === true) {
            stop = true;
            break;
          }
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

  return { newestTweetId };
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
  const found: ProfileOriginalTweet[] = [];
  const { newestTweetId } = await scanProfile(
    page,
    handle,
    { maxArticles: MAX_ARTICLES_TO_SCAN, maxAgeMs: MAX_AGE_MS, stopAtId: lastSeenTweetId },
    async (post) => { found.push(post); }
  );
  // found is newest-first (scan order); reverse so callers enqueue in the
  // order the tweets were actually posted.
  return { newOriginals: found.reverse(), newestTweetId };
}

/**
 * Scan a profile's Posts tab for every original post within maxAgeMs,
 * regardless of any previously-seen cursor, calling `onOriginalPost`
 * immediately as each one is found (streaming) rather than collecting a
 * batch and returning it — the "catch up on anything in this window" use
 * case (manual catch-up command).
 *
 * Streaming instead of collect-then-process isn't just pacing: it removes
 * the need to assume "the root of this thread is either elsewhere in the
 * same batch, or was already handled earlier" — an assumption that broke
 * in practice when a thread's root fell just outside maxAgeMs while a
 * later continuation (posted when the author came back to add more)
 * stayed inside it. The root was then never in the batch at all, and every
 * continuation's "root handles this instead" redirect pointed at a tweet
 * that would never be opened. Callers should instead check
 * TweetDetails.isRoot themselves per post and simply ignore any post that
 * isn't its own thread's root, rather than trying to chase/redirect to one.
 */
export async function scanProfileWithinWindow(
  page: Page,
  username: string,
  maxAgeMs: number,
  onOriginalPost: OnOriginalPost,
  maxArticles: number = MAX_ARTICLES_TO_SCAN
): Promise<void> {
  const handle = username.replace(/^@/, "");
  await scanProfile(page, handle, { maxArticles, maxAgeMs, stopAtId: null }, onOriginalPost);
}
