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
const MAX_ARTICLES_TO_SCAN = 10;

// Same cutoff as the notification-based skip gate (scoreTweet.ts) — a post
// this old isn't worth replying to regardless of source.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

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

  const articles = await page.locator("article").all();
  const found: ProfileOriginalTweet[] = [];
  let newestTweetId: string | null = null;

  for (let i = 0; i < Math.min(articles.length, MAX_ARTICLES_TO_SCAN); i++) {
    const article = articles[i];
    if (!article) break;

    const info = await article.evaluate((el: any) => {
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

    if (!info.id) continue;

    // A pinned tweet sits at position 0 forever, regardless of when it was
    // actually posted — it can be brand new or years old, and either way
    // it does NOT reflect chronological order relative to what's below it.
    // Reposts have the same problem (a years-old tweet can get reposted
    // today). Only a genuine chronological post can safely be used as the
    // "have I already scanned past everything new" cursor or trigger the
    // age-based cutoff — using a pinned tweet's ID for that would poison
    // the cursor permanently: every future visit would see article[0]
    // match lastSeenTweetId (itself) and break before ever checking
    // article[1] onward again.
    const isChronological = !info.isPinned && !info.isRepost;

    if (isChronological) {
      if (newestTweetId === null) {
        newestTweetId = info.id;
      }
      if (lastSeenTweetId && info.id === lastSeenTweetId) {
        break;
      }
      if (info.datetime && Date.now() - new Date(info.datetime).getTime() > MAX_AGE_MS) {
        // Profiles list posts newest-first, so once we hit a chronological
        // one over 12hr old everything after it is even older — stop.
        break;
      }
    }

    if (info.isRepost || info.isReply || !info.text) {
      continue;
    }

    // Pinned tweets are judged on their own merits (just the age check)
    // instead of being unconditionally skipped — a pin can be a genuinely
    // fresh post the author wants visible, not just old evergreen content.
    if (info.isPinned) {
      const ageMs = info.datetime ? Date.now() - new Date(info.datetime).getTime() : Infinity;
      if (ageMs > MAX_AGE_MS) {
        continue;
      }
    }

    found.push({
      id: info.id,
      url: info.href.startsWith("http") ? info.href : `https://x.com${info.href.split("?")[0]}`,
      text: info.text,
      author: `@${handle}`,
    });
  }

  // found is newest-first (DOM/scan order); reverse so callers enqueue in
  // the order the tweets were actually posted.
  return { newOriginals: found.reverse(), newestTweetId };
}
