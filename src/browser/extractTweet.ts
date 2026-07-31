import { Page } from "playwright";
import { expandTweet } from "./expandTweet";

export interface TweetDetails {
  author: string;
  handle: string;
  text: string;
  fullText: string;
  url: string;
  imageUrls: string[];
  // Video or GIF attached to the anchor tweet — X renders both through the
  // same [data-testid="videoPlayer"] component (a GIF is just a silent,
  // auto-looping video under the hood), so one flag covers both rather than
  // trying to tell them apart.
  hasVideo: boolean;
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
  // The quoted tweet's own status id. Extracted even for a same-author
  // quote (where quotedTweet/quotedTweetHandle below are suppressed as a
  // likely "show this thread" preview) — a deliberate self-quote-repost of
  // an already-replied tweet has the exact same DOM shape as that preview,
  // and checking hasReplied() on this id is how the two get told apart:
  // a not-yet-replied preview segment passes through untouched, while a
  // genuine repost of already-answered content gets caught.
  quotedTweetId?: string;
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
  // Whether the anchor is the FIRST tweet in its own same-author chain, or
  // a middle/later segment. False means this notification's own tweet
  // should never get a reply of its own — main-interactive.ts redirects to
  // rootId/rootUrl instead. Replying to whichever segment happened to
  // trigger the notification (instead of always the root) is exactly the
  // "why does this bot reply to every paragraph of the same story"
  // behavior that's one of the most obvious tells that it's a bot.
  isRoot: boolean;
  // The root tweet's id/url of this same-author chain, only set when
  // isRoot is false (i.e. there's actually somewhere else to redirect to).
  rootId?: string;
  rootUrl?: string;
  // Is this post actually part of a multi-tweet thread, in EITHER
  // direction? True if isRoot is false (this segment has an earlier
  // same-author predecessor — the backward walk found it), OR if the
  // forward walk below found later same-author segments and merged them
  // into fullText. The much more common case in practice is the second
  // one: Echo almost always opens/replies to a thread's ROOT (isRoot is
  // true for it by definition), so relying on isRoot alone to detect
  // "this author posts threads" misses nearly every real thread.
  isThread: boolean;
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
): Promise<{ text?: string; handle?: string; id?: string } | undefined> {
  try {
    const textNodes = await article.locator('[data-testid="tweetText"]').all();
    if (textNodes.length < 2) return undefined;

    const nameNodes = await article.locator('[data-testid="User-Name"]').all();
    if (nameNodes.length < 2) return undefined;

    const quoteAuthor = (await nameNodes[1]?.textContent({ timeout: 2000 }))?.trim() ?? "";
    const quoteHandle = quoteAuthor.match(/@\w+/)?.[0] ?? "";

    const quoteText = (await textNodes[1]?.textContent({ timeout: 2000 }))?.trim() ?? "";
    if (!quoteText) return undefined;

    // Quote card's own status id — same distinguishing logic readArticle
    // uses for the two <time> elements (a quoted tweet's <time> sits inside
    // a div[role="link"], not the anchor tweet's own a[role="link"]). Read
    // regardless of same-author-ness, below, so a genuine self-quote-repost
    // can still be checked against hasReplied() even though its text/handle
    // are suppressed.
    const id = await article.evaluate((el: any) => {
      const times: any[] = Array.from(el.querySelectorAll("time"));
      for (const t of times) {
        let node: any = t.parentElement;
        while (node && node !== el) {
          if (node.getAttribute("role") === "link" && node.tagName === "DIV") {
            const anchor = node.querySelector('a[href*="/status/"]');
            const href = anchor?.getAttribute("href") || "";
            const match = href.match(/status\/(\d+)/);
            if (match) return match[1];
          }
          node = node.parentElement;
        }
      }
      return null;
    });

    // Same author as the anchor — a "show this thread" preview, not a real
    // quote worth surfacing as text (the forward continuation-walk already
    // covers that content) — but the id is still returned so a deliberate
    // self-quote-repost of already-replied content can still be caught.
    if (quoteHandle && quoteHandle === rootHandle) {
      return id ? { id } : undefined;
    }

    return {
      text: quoteHandle ? `${quoteHandle}: ${quoteText}` : quoteText,
      handle: quoteHandle,
      ...(id ? { id } : {})
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

  // Which articles (by index, same order/count as `articles` above — this
  // must run before any further DOM changes) sit at or after X's
  // "Discover more" recommendations divider. Confirmed live: two totally
  // unrelated threads by the same author recommended EACH OTHER in their
  // own "Discover more" section — same author, well within TIME_WINDOW_MS
  // of each other, so the forward-walk's only two checks (author, time
  // window) both passed and it absorbed the other thread's content as if
  // it were a real continuation. DOM order is stable regardless of scroll
  // position, so this holds however far the page has been scrolled.
  const afterDiscoverMore: boolean[] = await page.evaluate(() => {
    const articleEls: any[] = Array.from((document as any).querySelectorAll("article"));
    const candidates: any[] = Array.from((document as any).querySelectorAll("div, span, h2"));
    const discoverEl = candidates.find((el: any) => (el.textContent ?? "").trim() === "Discover more");
    if (!discoverEl) return articleEls.map(() => false);
    const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
    return articleEls.map((el: any) => !!(discoverEl.compareDocumentPosition(el) & FOLLOWING));
  });

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

  // Walk backward from the anchor to find the true ROOT of a same-author
  // thread chain — not just the immediate predecessor. A middle/last
  // segment must redirect to the root instead of ever getting a reply of
  // its own (see TweetDetails.isRoot / main-interactive.ts), so this needs
  // the actual start of the chain, however many segments back that is.
  // previousThreadPost stays the immediate prior segment specifically
  // (context for analyzeTweet on what led into THIS segment); parentTweet
  // is whichever different-author tweet the walk hits when the same-author
  // run finally breaks — the whole chain's actual conversational parent,
  // not "the tweet before this one part."
  let rootIndex = anchorIndex;
  let parentTweet: string | undefined;
  let parentTweetHandle: string | undefined;
  let previousThreadPost: string | undefined;
  {
    let i = anchorIndex - 1;
    let checkedImmediatePredecessor = false;
    while (i >= 0) {
      const article = articles[i];
      if (!article) break;
      const parsed = await readArticle(article);
      if (!parsed || !parsed.text) break;

      if (parsed.handle === rootHandle && Math.abs(parsed.time - anchor.time) <= TIME_WINDOW_MS) {
        if (!checkedImmediatePredecessor) previousThreadPost = parsed.text;
        rootIndex = i;
        checkedImmediatePredecessor = true;
        i--;
        continue;
      }

      // Different author, or too far outside the window — the chain's
      // actual conversational parent. Stop walking back.
      parentTweet = parsed.handle ? `${parsed.handle}: ${parsed.text}` : parsed.text;
      parentTweetHandle = parsed.handle || undefined;
      break;
    }
  }

  const isRoot = rootIndex === anchorIndex;
  let rootId: string | undefined;
  let rootUrl: string | undefined;
  if (!isRoot) {
    const rootArticle = articles[rootIndex];
    const id = rootArticle ? await readArticleStatusId(rootArticle) : null;
    if (id) {
      rootId = id;
      rootUrl = `https://x.com/${rootHandle.replace(/^@/, "")}/status/${id}`;
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

  let hasVideo = false;
  try {
    hasVideo = (await anchorArticle.locator('[data-testid="videoPlayer"]').count()) > 0;
  } catch {
    // No video — that's fine
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
  // that breaks that run — a different author, one too far outside the
  // time window, or afterDiscoverMore (X's recommendations section, which
  // author/time-window checks alone do NOT reliably exclude — confirmed
  // live: two totally unrelated threads by the same author recommended
  // EACH OTHER, well within the time window, and got silently merged
  // before this explicit boundary check existed).
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
    if (afterDiscoverMore[i]) break;
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

  const isThread = !isRoot || threadTexts.length > 1;

  return {
    author: rootHandle,
    handle: rootHandle,
    text: firstText,
    fullText,
    url: page.url(),
    imageUrls,
    hasVideo,
    latestSegmentAt,
    replies,
    isRoot,
    isThread,
    ...(quotedTweet?.text ? { quotedTweet: quotedTweet.text } : {}),
    ...(quotedTweet?.handle ? { quotedTweetHandle: quotedTweet.handle } : {}),
    ...(quotedTweet?.id ? { quotedTweetId: quotedTweet.id } : {}),
    ...(parentTweet ? { parentTweet } : {}),
    ...(parentTweetHandle ? { parentTweetHandle } : {}),
    ...(previousThreadPost ? { previousThreadPost } : {}),
    ...(rootId ? { rootId } : {}),
    ...(rootUrl ? { rootUrl } : {})
  };
}
