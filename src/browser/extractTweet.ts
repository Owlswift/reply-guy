import { Page } from "playwright";
import { expandTweet } from "./expandTweet";

export interface TweetDetails {
  author: string;
  handle: string;
  text: string;
  fullText: string;
  url: string;
  imageUrls: string[];
  // Epoch ms of the most recently posted segment in the thread (the
  // anchor's own time if it's a single tweet). Lets callers tell a thread
  // that's still actively being posted apart from one that's settled.
  latestSegmentAt: number;
  // Reply count on the anchor tweet, read directly off the open page. Lets
  // callers re-check staleness (scoreTweet.ts's isStaleByAgeAndReplies) at
  // open-time — needed for anything that reached PHASE 3 without ever going
  // through the notification-stage age/reply check, e.g. a tweet pulled back
  // in from the low-priority deferral cache (storage/lowPriorityTweets.ts),
  // which only ever stores a bare URL and can't know how stale it's gotten
  // by the time it's finally opened.
  replies: number;
  // The embedded quote-card's own text, when the anchor tweet quotes someone
  // ELSE's tweet (a same-author "show this thread" preview card is NOT
  // surfaced here — see readQuotedTweet). Undefined when there's no quote.
  quotedTweet?: string;
  // The quoted tweet's author handle (e.g. "@someuser"), exposed separately
  // from the formatted quotedTweet string so callers can check it against
  // BLOCKED_HANDLES without having to regex-parse it back out.
  quotedTweetHandle?: string;
  // The tweet immediately above the anchor in the DOM — the tweet it's
  // directly replying to, when that tweet is by a DIFFERENT author. Without
  // this, a reply like "this generation is cooked" gets analyzed with no
  // idea it might be quoting/replying to "my girlfriend bought me a car for
  // my birthday" and completely inverting the intended meaning.
  parentTweet?: string;
  // The parent tweet's author handle, exposed separately from the formatted
  // parentTweet string for the same reason as quotedTweetHandle — checking
  // it against BLOCKED_HANDLES without regex-parsing it back out.
  parentTweetHandle?: string;
  // Same DOM position as parentTweet, but for when the tweet immediately
  // above the anchor is by the SAME author — an earlier segment of the
  // author's own thread that led into this one, distinct from a genuine
  // reply-to-someone-else.
  previousThreadPost?: string;
}

const TIME_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

async function readArticle(article: ReturnType<Page["locator"]>) {
  let author = "";
  try {
    author =
      (await article
        .locator('[data-testid="User-Name"]')
        .first()
        .textContent({ timeout: 2000 }))?.trim() ?? "";
  } catch {
    return null;
  }

  // When a tweet quote-tweets or previews another one, the article contains
  // two <time> elements and their DOM order isn't reliable (verified: a
  // plain quote-tweet puts the quoted tweet's older <time> first, but a
  // "show this thread" preview card puts the newer one first). What IS
  // consistent: this tweet's own <time> is wrapped in an <a role="link">
  // (a direct permalink anchor), while a nested/quoted tweet's <time> is
  // wrapped in a <div role="link"> (the quote-card container) — walk up
  // from each <time> to its closest role="link" ancestor and use the tag
  // to tell them apart.
  const datetime = await article.evaluate((el: any) => {
    const times: any[] = Array.from(el.querySelectorAll("time"));
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
      if (roleLinkTag === "A") return t.getAttribute("datetime");
    }
    return times[0]?.getAttribute("datetime") ?? null;
  }) ?? "";
  const time = datetime ? new Date(datetime).getTime() : 0;

  let text = "";
  try {
    text =
      (await article
        .locator('[data-testid="tweetText"]')
        .first()
        .textContent({ timeout: 2000 }))?.trim() ?? "";
  } catch {
    // No text (e.g. image-only tweet) — still a valid article, just no text to collect.
  }

  return { handle: author.match(/@\w+/)?.[0] ?? "", time, text };
}

/**
 * Status id of the tweet THIS article's own permalink points to (the
 * <a role="link"> wrapping its <time>, same distinguishing logic readArticle
 * uses to pick the right timestamp) — lets us confirm which article in the
 * DOM is actually the tweet the page navigated to, instead of assuming it's
 * always articles[0]. X's permalink pages render ancestor tweets in a reply
 * chain ABOVE the target tweet, so articles[0] silently being an ancestor
 * instead of the anchor was a real (if rare) risk with no check at all.
 */
async function readArticleStatusId(article: ReturnType<Page["locator"]>): Promise<string | null> {
  try {
    return await article.evaluate((el: any) => {
      const times: any[] = Array.from(el.querySelectorAll("time"));
      for (const t of times) {
        const link = t.closest('a[role="link"]');
        if (link) {
          const href = link.getAttribute("href") || "";
          const match = href.match(/status\/(\d+)/);
          if (match) return match[1];
        }
      }
      return null;
    });
  } catch {
    return null;
  }
}

/**
 * Read an embedded quote-card's own text, when the anchor tweet quotes
 * someone else's tweet. A single article can render a SECOND
 * [data-testid="tweetText"]/[data-testid="User-Name"] pair for one of two
 * reasons: a genuine quote-tweet, or a same-author "show this thread"
 * preview card (see readArticle's comment on the two <time> elements).
 * Only the former is a real quote worth surfacing — if the second author
 * matches the anchor's own handle, this is just a thread-preview link, and
 * the forward continuation-walk in extractCurrentTweet already covers that
 * content, so surfacing it again here would be redundant at best and
 * mislabeled as "quoting someone" at worst.
 */
async function readQuotedTweet(
  article: ReturnType<Page["locator"]>,
  rootHandle: string
): Promise<{ text: string; handle: string } | undefined> {
  try {
    const textNodes = await article.locator('[data-testid="tweetText"]').all();
    if (textNodes.length < 2) return undefined;

    const nameNodes = await article.locator('[data-testid="User-Name"]').all();
    if (nameNodes.length < 2) return undefined;

    const quoteAuthor = (await nameNodes[1]?.textContent({ timeout: 2000 }))?.trim() ?? "";
    const quoteHandle = quoteAuthor.match(/@\w+/)?.[0] ?? "";

    // Same author as the anchor — a "show this thread" preview, not a real quote.
    if (quoteHandle && quoteHandle === rootHandle) return undefined;

    const quoteText = (await textNodes[1]?.textContent({ timeout: 2000 }))?.trim() ?? "";
    if (!quoteText) return undefined;

    return {
      text: quoteHandle ? `${quoteHandle}: ${quoteText}` : quoteText,
      handle: quoteHandle
    };
  } catch {
    return undefined;
  }
}

export async function extractCurrentTweet(
  page: Page
): Promise<TweetDetails | null> {

  // Wait for article with timeout
  try {
    await page.waitForSelector("article", { timeout: 5000 });
  } catch {
    // No article on the page (tweet deleted, layout changed, etc.) — a normal
    // condition when automating X, not an error.
    return null;
  }

  // Expand any "Show more" links first
  await expandTweet(page);

  const articles = await page.locator("article").all();
  if (articles.length === 0) {
    return null;
  }

  // The anchor is whichever tweet the page opened to. Confirm it by matching
  // this article's own permalink status id against the URL's — X's permalink
  // pages render ancestor tweets in a reply chain ABOVE the target tweet, so
  // assuming articles[0] is always the anchor (the old behavior) could
  // silently treat a parent tweet as the anchor instead. Falls back to
  // articles[0] if the id can't be matched (id extraction fails, URL has no
  // status id, DOM shape is unexpected) — same behavior as before this check
  // existed, never worse.
  const urlStatusId = page.url().match(/status\/(\d+)/)?.[1] ?? null;
  let anchorIndex = 0;
  if (urlStatusId) {
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      if (!article) continue;
      const id = await readArticleStatusId(article);
      if (id === urlStatusId) {
        anchorIndex = i;
        break;
      }
    }
  }

  const anchorArticle = articles[anchorIndex];
  if (!anchorArticle) {
    return null;
  }

  const anchor = await readArticle(anchorArticle);
  if (!anchor) {
    return null;
  }
  const rootHandle = anchor.handle;

  // The tweet immediately above the anchor, if any — either the tweet it's
  // directly replying to (a different author: parentTweet) or an earlier
  // segment of the author's own thread (same author: previousThreadPost).
  // Only the immediate one; deeper chains are out of scope for now.
  let parentTweet: string | undefined;
  let parentTweetHandle: string | undefined;
  let previousThreadPost: string | undefined;
  if (anchorIndex > 0) {
    const prevArticle = articles[anchorIndex - 1];
    const prevParsed = prevArticle ? await readArticle(prevArticle) : null;
    if (prevParsed && prevParsed.text) {
      if (prevParsed.handle === rootHandle) {
        previousThreadPost = prevParsed.text;
      } else {
        parentTweet = prevParsed.handle ? `${prevParsed.handle}: ${prevParsed.text}` : prevParsed.text;
        parentTweetHandle = prevParsed.handle || undefined;
      }
    }
  }

  const quotedTweet = await readQuotedTweet(anchorArticle, rootHandle);

  const imageUrls: string[] = [];
  try {
    const images = await anchorArticle.locator('div[data-testid="tweetPhoto"] img').all();
    for (const img of images) {
      const src = await img.getAttribute("src");
      if (src && !src.includes("profile_images") && !imageUrls.includes(src)) {
        imageUrls.push(src);
      }
    }
  } catch {
    // No images — that's fine
  }

  // Same reply-count read as extractTweets.ts's timeline scraper, but here
  // for the anchor tweet on the already-open permalink page — lets callers
  // re-check staleness right before opening it (see TweetDetails.replies).
  let replies = 0;
  try {
    const replyText = await anchorArticle
      .locator('[data-testid="reply"]')
      .first()
      .textContent({ timeout: 2000 });
    replies = parseInt(replyText?.trim() || "0", 10) || 0;
  } catch {
    // Couldn't read it — default to 0 rather than block on it
  }

  // A thread is a strictly sequential run of the same author's tweets.
  // Walk forward from the anchor and stop PERMANENTLY at the first article
  // that breaks that run — a different author, or one too far outside the
  // time window. Do not resume matching afterward even if a later article
  // happens to carry the same author's name again (X appends unrelated
  // "Discover more" recommendations after the real thread ends, often by
  // the same author on a completely different topic — those must never be
  // pulled back in just because the handle matches).
  const seenTexts = new Set<string>();
  const threadTexts: string[] = [];
  let latestSegmentAt = anchor.time;
  const record = (text: string, time: number) => {
    if (!text || seenTexts.has(text)) return;
    seenTexts.add(text);
    threadTexts.push(text);
    if (time > latestSegmentAt) latestSegmentAt = time;
  };
  record(anchor.text, anchor.time);

  for (let i = anchorIndex + 1; i < articles.length; i++) {
    const article = articles[i];
    if (!article) break;
    const parsed = await readArticle(article);
    if (!parsed || parsed.handle !== rootHandle) break;
    if (Math.abs(parsed.time - anchor.time) > TIME_WINDOW_MS) break;
    record(parsed.text, parsed.time);
  }

  const fullText = threadTexts.join("\n\n");
  const firstText = threadTexts[0] ?? anchor.text;

  // If we couldn't extract any text, there's nothing to reply to.
  if (!firstText) {
    return null;
  }

  return {
    author: rootHandle,
    handle: rootHandle,
    text: firstText,
    fullText,
    url: page.url(),
    imageUrls,
    latestSegmentAt,
    replies,
    ...(quotedTweet ? { quotedTweet: quotedTweet.text } : {}),
    ...(quotedTweet?.handle ? { quotedTweetHandle: quotedTweet.handle } : {}),
    ...(parentTweet ? { parentTweet } : {}),
    ...(parentTweetHandle ? { parentTweetHandle } : {}),
    ...(previousThreadPost ? { previousThreadPost } : {})
  };
}
