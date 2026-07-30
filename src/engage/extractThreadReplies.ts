import { Page } from "playwright";
import { randomDelayMs } from "../behavior/delays";

export interface ExtractedReply {
  id: string;
  authorHandle: string;
  authorName: string;
  text: string;
  createdAt: number;
  isByMe: boolean;
  parentReplyId: string | null;
  depth: number;
}

export interface ThreadData {
  rootTweetId: string;
  rootTweetUrl: string;
  rootTweetAuthor: string;
  rootTweetHandle: string;
  rootTweetText: string;
  replies: ExtractedReply[];
}

/**
 * Extract the status id from a tweet URL.
 */
function extractTweetId(url: string): string | null {
  const match = url.match(/status\/(\d+)/);
  if (!match || !match[1]) return null;
  return match[1];
}

/**
 * Extract the handle from a tweet URL.
 */
function extractHandle(url: string): string | null {
  const match = url.match(/x\.com\/([^/]+)\/status/);
  if (!match || !match[1]) return null;
  return `@${match[1]}`;
}

/**
 * Open a tweet URL and extract the full thread structure.
 *
 * Flow:
 * 1. Navigate to the tweet
 * 2. Wait for the page to load
 * 3. Expand all "Show more" / "Show replies" links
 * 4. Scroll to load more replies
 * 5. Extract all reply articles
 * 6. Build the thread tree
 */
export async function extractThreadReplies(
  page: Page,
  tweetUrl: string
): Promise<ThreadData | null> {
  const tweetId = extractTweetId(tweetUrl);
  if (!tweetId) {
    console.error(`[engage] Could not extract tweet id from URL: ${tweetUrl}`);
    return null;
  }

  const extractedHandle = extractHandle(tweetUrl) ?? "";

  // Navigate to the tweet
  console.log(`[engage] Opening tweet: ${tweetUrl}`);
  await page.goto(tweetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for the main article to appear
  try {
    await page.waitForSelector("article", { timeout: 15000 });
  } catch {
    console.error("[engage] No article found on the page");
    return null;
  }

  // Human-like pause after opening
  await page.waitForTimeout(randomDelayMs(1000, 2500));

  // Expand all "Show more" links in the tweet text
  console.log("[engage] Expanding 'Show more' links...");
  await expandShowMoreLinks(page);

  // Locate the root tweet's own article BEFORE any scrolling. X virtualizes
  // long reply lists — articles scrolled far enough out of view can get
  // unmounted from the DOM entirely to save memory — so the root (and any
  // replies near it) must be captured while still guaranteed present,
  // not looked up again after scrolling has potentially pushed it out.
  const rootArticle = await locateFocusedArticle(page, tweetId, extractedHandle);
  if (!rootArticle) {
    console.error("[engage] Could not extract root tweet");
    return null;
  }

  const myHandle = extractedHandle || rootArticle.handle;

  // Scroll to load more replies, capturing reply data after EVERY step
  // rather than only once at the end — for the same virtualization reason:
  // extracting only after scrolling finishes would silently lose any
  // reply that scrolled out of the mounted window along the way, which is
  // indistinguishable from "never found it" and no amount of scroll
  // patience fixes it, since the problem isn't scrolling far enough, it's
  // forgetting what was already seen.
  console.log("[engage] Scrolling to load replies...");
  const replies = await scrollAndCaptureReplies(page, tweetId, myHandle);

  console.log(`[engage] Found ${replies.length} replies in the thread`);

  return {
    rootTweetId: tweetId,
    rootTweetUrl: tweetUrl,
    rootTweetAuthor: rootArticle.author,
    rootTweetHandle: rootArticle.handle,
    rootTweetText: rootArticle.text,
    replies,
  };
}

/**
 * Expand all "Show more" / "Show replies" / "Show additional replies"
 * buttons currently visible on the page.
 *
 * Called repeatedly — once up front AND again after every scroll (see
 * scrollAndCaptureReplies) — because these prompts frequently only render once
 * you've scrolled far enough for that part of the thread to mount; running
 * this once at the very top misses every one of them that appears further
 * down, silently leaving whole reply sub-threads collapsed and invisible
 * to extraction.
 *
 * The per-tweet expanders ("Show more", "Show replies", "Show this
 * thread") are scoped to spans inside <article> (tweet) elements only —
 * X's right-hand "Trends for you" sidebar widget has its own "Show more"
 * link that navigates to /explore/tabs/for-you, and an unscoped page-wide
 * search matches that just as readily, silently hijacking the scan tab off
 * the thread entirely. "Show additional replies" (X's gate for
 * likely-spam/low-quality/filtered replies) is a page-level prompt, not
 * part of any single tweet's article, so it's matched unscoped instead —
 * safe because its wording is distinctive enough not to collide with
 * anything else on the page.
 */
async function expandShowMoreLinks(page: Page): Promise<void> {
  let expanded = 0;
  const maxExpansions = 50;

  for (let i = 0; i < maxExpansions; i++) {
    try {
      // Look for "Show more" buttons (expands truncated tweet text)
      const showMore = page.locator('article span').filter({ hasText: /^Show more$/ }).first();
      if (await showMore.isVisible().catch(() => false)) {
        await showMore.click();
        await page.waitForTimeout(randomDelayMs(300, 800));
        expanded++;
        continue;
      }

      // Look for "Show replies" buttons (expands hidden reply threads)
      const showReplies = page.locator('article span').filter({ hasText: /^Show replies$/ }).first();
      if (await showReplies.isVisible().catch(() => false)) {
        await showReplies.click();
        await page.waitForTimeout(randomDelayMs(300, 800));
        expanded++;
        continue;
      }

      // Look for "Show this thread" buttons
      const showThread = page.locator('article span').filter({ hasText: /^Show this thread$/ }).first();
      if (await showThread.isVisible().catch(() => false)) {
        await showThread.click();
        await page.waitForTimeout(randomDelayMs(300, 800));
        expanded++;
        continue;
      }

      // Look for "Show additional replies" / "Show probable spam" gates —
      // X's own wording for replies filtered out of the default view.
      // Unscoped (not "article span") since this prompt isn't part of any
      // tweet's own article.
      const showAdditional = page.locator("span, div").filter({ hasText: /show (additional replies|more replies|probable spam)/i }).first();
      if (await showAdditional.isVisible().catch(() => false)) {
        await showAdditional.click();
        await page.waitForTimeout(randomDelayMs(500, 1000));
        expanded++;
        continue;
      }

      // No more expandable links
      break;
    } catch {
      break;
    }
  }

  if (expanded > 0) {
    console.log(`[engage] Expanded ${expanded} hidden sections`);
  }
}

/**
 * Scroll down to trigger X's lazy-loading of replies, extracting whatever
 * reply articles are currently mounted after EVERY scroll step and merging
 * them (deduped by id) into a running accumulator — not just once at the
 * very end. X virtualizes long reply lists, unmounting articles once
 * they've scrolled far enough out of view; extracting only at the end
 * would silently lose anything unmounted along the way, indistinguishable
 * from "there was nothing there" and unfixable by scrolling further/more
 * patiently, since the content WAS seen, just not remembered.
 *
 * Skips whatever article matches `rootTweetId` at each pass — the root
 * itself isn't a reply, and its DOM position can vary (see
 * locateFocusedArticle).
 */
async function scrollAndCaptureReplies(
  page: Page,
  rootTweetId: string,
  myHandle: string
): Promise<ExtractedReply[]> {
  const repliesById = new Map<string, ExtractedReply>();

  const captureVisible = async (): Promise<number> => {
    const articles = await page.locator("article").all();
    let newlyCaptured = 0;

    for (const article of articles) {
      const permalinkId = await getArticlePermalinkId(article);
      if (!permalinkId || permalinkId === rootTweetId) continue;
      if (repliesById.has(permalinkId)) continue;

      try {
        const reply = await extractSingleReply(article, myHandle);
        if (reply) {
          repliesById.set(reply.id, reply);
          newlyCaptured++;
        }
      } catch {
        // Skip articles we can't parse
      }
    }

    return newlyCaptured;
  };

  // Capture whatever's already mounted before any scrolling.
  await captureVisible();

  const maxScrolls = 25;
  let noNewRepliesCount = 0;

  for (let i = 0; i < maxScrolls; i++) {
    // Re-check for "show more"/"show replies"/"show additional replies"
    // prompts before scrolling further — these often only render once this
    // part of the thread has scrolled into view, not just at the very top.
    await expandShowMoreLinks(page);

    // Scroll down
    await page.evaluate(() => {
      // @ts-expect-error - `window` is available in the browser context
      window.scrollBy(0, 800);
    });

    await page.waitForTimeout(randomDelayMs(600, 1400));

    const newlyCaptured = await captureVisible();

    if (newlyCaptured === 0) {
      noNewRepliesCount++;
      // Give lazy-loading more chances before concluding we're done —
      // slower-loading batches can otherwise get mistaken for the end of
      // the thread.
      if (noNewRepliesCount >= 4) break;
    } else {
      noNewRepliesCount = 0;
    }
  }

  // Final pass in case content settled after the last scroll.
  await expandShowMoreLinks(page);
  await captureVisible();

  console.log(`[engage] Scrolled up to ${maxScrolls} times, captured ${repliesById.size} distinct replies`);

  return buildReplyTree(Array.from(repliesById.values()));
}

/**
 * Get the permalink status id rendered inside a given article, if any.
 * Shared by root-tweet lookup, reply extraction, and permalink-context
 * lookup so "which tweet is this article actually" is answered the same
 * way everywhere.
 *
 * Must be the tweet's OWN permalink, not just any status link inside the
 * article — an article can contain several: a quoted tweet's link, a
 * "Show this thread" / conversation-root link, a "Replying to" link, in
 * addition to the tweet's own. `querySelector('a[href*="/status/"]')`
 * returns whichever of those happens to come first in the DOM, which is
 * NOT reliably the tweet's own id — X always wraps the tweet's own
 * timestamp ("2h", "Jul 28") in a link to its own permalink, so anchoring
 * on that specific link is the unambiguous way to get this article's own id.
 */
async function getArticlePermalinkId(
  article: ReturnType<Page["locator"]>
): Promise<string | null> {
  return article.evaluate((el) => {
    const timeEl = el.querySelector("time");
    const ownLink = timeEl?.closest('a[href*="/status/"]');
    const link = ownLink ?? el.querySelector('a[href*="/status/"]');
    if (!link) return null;
    const href = link.getAttribute("href");
    const match = href?.match(/status\/(\d+)/);
    return match ? match[1] : null;
  }).catch(() => null);
}

/**
 * Extract just the author (handle + display name) and text of an article —
 * no timestamp/permalink/reply-tree bookkeeping, unlike extractSingleReply.
 */
async function extractArticleAuthorAndText(
  article: ReturnType<Page["locator"]>
): Promise<{ author: string; handle: string; text: string } | null> {
  try {
    const authorText = await article
      .locator('[data-testid="User-Name"]')
      .first()
      .textContent({ timeout: 5000 });

    if (!authorText) return null;

    const handle = authorText.match(/@(\w+)/)?.[0] ?? "";
    const author = (authorText.split("@")[0] ?? "").trim();

    const text =
      (await article
        .locator('[data-testid="tweetText"]')
        .first()
        .textContent({ timeout: 5000 }))?.trim() ?? "";

    return { author, handle, text };
  } catch {
    return null;
  }
}

/**
 * Locate the article for a specific tweet on its own permalink page — the
 * one matching `targetTweetId`, whatever its position — and return both
 * its DOM index and its extracted author/text.
 *
 * Two strategies, because neither alone is reliable:
 *
 * 1. Exact id match via the tweet's own timestamp-permalink link
 *    (getArticlePermalinkId). This fails for exactly the article we need
 *    most often: X does not link the FOCUSED tweet's own timestamp back to
 *    itself (there's nowhere useful to navigate from its own page) — it
 *    renders the full date/view-count instead, with no wrapping <a>. Every
 *    ancestor and every reply DOES get that self-link, so this strategy
 *    reliably finds everything EXCEPT the one tweet that IS the page.
 *
 * 2. Fall back to `authorHandle` (parsed from the URL, e.g. the account
 *    that owns this permalink): find the LAST article in the leading run
 *    authored by that handle. This covers both a standalone tweet (article
 *    0) and the tail of that author's own self-thread (several consecutive
 *    self-authored articles), while correctly skipping any ancestor
 *    tweet(s) by OTHER accounts that X renders above it when this tweet is
 *    itself a reply to someone else.
 *
 * Falls back to article 0 only if both strategies fail outright.
 */
async function locateFocusedArticle(
  page: Page,
  targetTweetId: string,
  authorHandle: string
): Promise<{ index: number; author: string; handle: string; text: string } | null> {
  const articles = await page.locator("article").all();

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    if (!article) continue;
    const permalinkId = await getArticlePermalinkId(article);
    if (permalinkId !== targetTweetId) continue;

    const extracted = await extractArticleAuthorAndText(article);
    if (extracted) return { index: i, ...extracted };
  }

  if (authorHandle) {
    const normalized = authorHandle.replace(/^@/, "").toLowerCase();
    let bestIndex = -1;
    let bestInfo: { author: string; handle: string; text: string } | null = null;
    let sawMatch = false;

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      if (!article) continue;
      const info = await extractArticleAuthorAndText(article);
      const isMatch = (info?.handle ?? "").replace(/^@/, "").toLowerCase() === normalized;

      if (isMatch) {
        bestIndex = i;
        bestInfo = info;
        sawMatch = true;
        continue;
      }
      // Stop extending once we hit a different author AFTER already
      // matching at least once — that's the boundary between the leading
      // self-authored run and whatever comes after it (replies, or an
      // unrelated ancestor if the match never happened).
      if (sawMatch) break;
    }

    if (bestInfo) return { index: bestIndex, ...bestInfo };
  }

  // Last resort: neither strategy found anything — assume the first
  // article rather than failing the whole scan outright.
  const firstArticle = page.locator("article").first();
  const extracted = await extractArticleAuthorAndText(firstArticle);
  return extracted ? { index: 0, ...extracted } : null;
}

/**
 * Navigate-and-extract the verified context for a single reply: its own
 * text plus the tweet/comment immediately ABOVE it in the ancestor chain —
 * i.e. what it is actually replying to. This is X's own rendering of the
 * thread (ancestors first, then the focused tweet matching the URL, then
 * its descendants), which is unambiguous — unlike buildReplyTree's
 * DOM-order-plus-@mention heuristic over the flat root-tweet scan, which
 * can misattribute parentage in nested or out-of-order threads.
 *
 * Assumes `page` is already navigated to the reply's own permalink URL
 * (https://x.com/{handle}/status/{replyId}) and has an <article> loaded.
 */
export async function extractReplyPermalinkContext(
  page: Page,
  replyId: string,
  replyAuthorHandle: string,
  echoHandle?: string
): Promise<{
  replyAuthor: string;
  replyText: string;
  parentAuthor: string;
  parentText: string;
  parentId: string;
  hasParent: boolean;
  alreadyRepliedByMe: boolean;
} | null> {
  try {
    // Expand any truncated "Show more" tweet text BEFORE reading anything —
    // extractThreadReplies() (the full-thread scan) already does this, but
    // this function reads the root tweet's and the comment's own text
    // straight off the DOM with no expansion step, so a long original tweet
    // or a long comment silently got fed to the reply-generation prompt as
    // a truncated preview instead of its full text.
    await expandShowMoreLinks(page);

    const focused = await locateFocusedArticle(page, replyId, replyAuthorHandle);
    if (!focused) return null;

    const articles = await page.locator("article").all();

    let parent: { author: string; handle: string; text: string } | null = null;
    let parentId = "";
    if (focused.index > 0) {
      const parentArticle = articles[focused.index - 1];
      if (parentArticle) {
        parent = await extractArticleAuthorAndText(parentArticle);
        parentId = (await getArticlePermalinkId(parentArticle)) ?? "";
      }
    }

    // Has Echo (or the operator, manually) already replied to THIS specific
    // comment? Only articles AFTER the focused one are actual replies TO
    // it. Checking "any article on this page authored by Echo" (as opposed
    // to specifically the ones after the focused index) would always be
    // true and never detect anything real: the ancestor immediately above
    // the focused article (read as `parent` above) is guaranteed to be
    // Echo's own post/reply — that's what made this a candidate reply in
    // the first place — and X also renders the "Replying to @echoHandle"
    // indicator as part of the focused article's own text, which contains
    // a link to Echo's profile regardless of whether Echo ever answered it.
    let alreadyRepliedByMe = false;
    if (echoHandle) {
      const normalizedEcho = echoHandle.replace(/^@/, "").toLowerCase();
      for (let i = focused.index + 1; i < articles.length; i++) {
        const descendant = articles[i];
        if (!descendant) continue;
        const info = await extractArticleAuthorAndText(descendant);
        if ((info?.handle ?? "").replace(/^@/, "").toLowerCase() === normalizedEcho) {
          alreadyRepliedByMe = true;
          break;
        }
      }
    }

    return {
      replyAuthor: focused.handle,
      replyText: focused.text,
      parentAuthor: parent?.handle ?? "",
      parentText: parent?.text ?? "",
      parentId,
      hasParent: parent !== null,
      alreadyRepliedByMe,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a single reply from an article element.
 */
async function extractSingleReply(
  article: ReturnType<Page["locator"]>,
  myHandle: string
): Promise<ExtractedReply | null> {
  // Get author
  const authorText = await article
    .locator('[data-testid="User-Name"]')
    .first()
    .textContent({ timeout: 3000 })
    .catch(() => null);

  if (!authorText) return null;

  const handle = authorText.match(/@(\w+)/)?.[0] ?? "";
  const authorName = (authorText.split("@")[0] ?? "").trim();

  // Get text
  const text =
    (await article
      .locator('[data-testid="tweetText"]')
      .first()
      .textContent({ timeout: 3000 })
      .catch(() => ""))?.trim() ?? "";

  if (!text && !handle) return null;

  // Get timestamp
  const datetime = await article
    .locator("time")
    .first()
    .getAttribute("datetime")
    .catch(() => null);

  const createdAt = datetime ? new Date(datetime).getTime() : Date.now();

  // Get the tweet's permalink id from the article
  const permalinkId = await getArticlePermalinkId(article);

  if (!permalinkId) return null;

  // Determine if this reply is by me (Echo)
  const isByMe = handle.toLowerCase() === myHandle.toLowerCase();

  // Try to find the parent reply — X renders the "Replying to" indicator
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replyingTo = await article.evaluate((el: any) => {
    const spans = Array.from(el.querySelectorAll("span"));
    for (const span of spans) {
      const text = (span as any).textContent || "";
      const match = text.match(/Replying to @(\w+)/);
      if (match) return match[1];
    }
    return null;
  }).catch(() => null);

  return {
    id: permalinkId,
    authorHandle: handle,
    authorName,
    text,
    createdAt,
    isByMe,
    parentReplyId: null, // Will be set by buildReplyTree
    depth: 0, // Will be set by buildReplyTree
  };
}

/**
 * Build the reply tree by analyzing the order and structure of replies.
 *
 * X renders replies in a flat list, but the tree structure is implied by:
 * 1. The "Replying to @user" indicator
 * 2. The DOM order (a reply to a reply appears after the parent)
 * 3. The depth of indentation (if any)
 *
 * This is a best-effort reconstruction. We use a heuristic:
 * - If reply A appears after reply B in the DOM, and A is replying to B's author,
 *   then A is a child of B.
 * - Otherwise, A is a direct reply to the root tweet.
 */
function buildReplyTree(replies: ExtractedReply[]): ExtractedReply[] {
  if (replies.length === 0) return replies;

  // Build a map of handle -> most recent reply id for parent resolution
  const handleToLatestReply = new Map<string, string>();

  for (const reply of replies) {
    handleToLatestReply.set(reply.authorHandle, reply.id);
  }

  // Try to determine parent-child relationships
  // We look at the "Replying to" text that X renders
  // Since we already extracted that in extractSingleReply, we need to
  // cross-reference it with the replies we've found
  for (let i = 0; i < replies.length; i++) {
    const reply = replies[i];
    if (!reply) continue;

    // Default: direct reply to root (depth 0)
    reply.depth = 0;
    reply.parentReplyId = null;

    // Look backwards to find a potential parent
    for (let j = i - 1; j >= 0; j--) {
      const potentialParent = replies[j];
      if (!potentialParent) continue;

      // If this reply is by a different author than the potential parent,
      // it might be a child
      if (potentialParent.authorHandle !== reply.authorHandle) {
        // Check if there's a "Replying to" relationship
        const parentMention = `@${potentialParent.authorHandle.replace(/^@/, "")}`;
        if (reply.text.toLowerCase().includes(parentMention.toLowerCase())) {
          reply.parentReplyId = potentialParent.id;
          reply.depth = potentialParent.depth + 1;
          break;
        }
      }
    }
  }

  return replies;
}

/**
 * Check if Echo has already replied in this thread by looking at the page.
 * This is a browser-based check that looks for our handle in the replies.
 */
export async function hasEchoRepliedOnPage(
  page: Page,
  echoHandle: string
): Promise<boolean> {
  try {
    const articles = await page.locator("article").all();

    for (let i = 1; i < articles.length; i++) {
      const article = articles[i];
      if (!article) continue;

      const authorText = await article
        .locator('[data-testid="User-Name"]')
        .first()
        .textContent({ timeout: 2000 })
        .catch(() => null);

      if (!authorText) continue;

      const handle = authorText.match(/@(\w+)/)?.[0] ?? "";
      if (handle.toLowerCase() === echoHandle.toLowerCase()) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}