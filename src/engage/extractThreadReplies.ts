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

  // Scroll to load more replies — X loads replies lazily
  console.log("[engage] Scrolling to load replies...");
  await scrollToLoadReplies(page);

  // Extract the root tweet info
  const rootTweet = await extractRootTweet(page);
  if (!rootTweet) {
    console.error("[engage] Could not extract root tweet");
    return null;
  }

  // Extract all reply articles
  console.log("[engage] Extracting replies...");
  const replies = await extractAllReplies(page, extractedHandle ?? rootTweet.handle);

  console.log(`[engage] Found ${replies.length} replies in the thread`);

  return {
    rootTweetId: tweetId,
    rootTweetUrl: tweetUrl,
    rootTweetAuthor: rootTweet.author,
    rootTweetHandle: rootTweet.handle,
    rootTweetText: rootTweet.text,
    replies,
  };
}

/**
 * Expand all "Show more" / "Show replies" buttons on the page.
 *
 * Scoped to spans inside <article> (tweet) elements only — X's right-hand
 * "Trends for you" sidebar widget has its own "Show more" link that
 * navigates to /explore/tabs/for-you, and an unscoped page-wide search
 * matches that just as readily as a tweet's own truncated-text expander,
 * silently hijacking the scan tab off the thread entirely.
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
 * Scroll down to trigger X's lazy-loading of replies.
 * X loads replies in batches as you scroll.
 */
async function scrollToLoadReplies(page: Page): Promise<void> {
  const maxScrolls = 15;
  let previousCount = 0;
  let noNewRepliesCount = 0;

  for (let i = 0; i < maxScrolls; i++) {
    // Count current articles
    const currentCount = await page.locator("article").count();

    if (currentCount === previousCount) {
      noNewRepliesCount++;
      // If we've scrolled 3 times with no new articles, we're done
      if (noNewRepliesCount >= 3) break;
    } else {
      noNewRepliesCount = 0;
    }

    previousCount = currentCount;

    // Scroll down
    await page.evaluate(() => {
      // @ts-expect-error - `window` is available in the browser context
      window.scrollBy(0, 800);
    });

    await page.waitForTimeout(randomDelayMs(500, 1200));
  }

  console.log(`[engage] Scrolled ${maxScrolls - noNewRepliesCount} times, found ${previousCount} total articles`);
}

/**
 * Extract the root tweet's author and text from the page.
 */
async function extractRootTweet(
  page: Page
): Promise<{ author: string; handle: string; text: string } | null> {
  try {
    // The first article on a tweet permalink page is usually the root tweet
    const firstArticle = page.locator("article").first();

    const authorText = await firstArticle
      .locator('[data-testid="User-Name"]')
      .first()
      .textContent({ timeout: 5000 });

    const handle = authorText?.match(/@(\w+)/)?.[0] ?? "";
    const author = (authorText?.split("@")[0] ?? "").trim();

    const text =
      (await firstArticle
        .locator('[data-testid="tweetText"]')
        .first()
        .textContent({ timeout: 5000 }))?.trim() ?? "";

    return { author, handle, text };
  } catch {
    return null;
  }
}

/**
 * Extract all reply articles from the page.
 *
 * We identify replies by looking at articles that are NOT the root tweet.
 * Each reply article has:
 *   - A User-Name element (author)
 *   - A tweetText element (content)
 *   - A time element (timestamp)
 *   - A reply button (data-testid="reply")
 */
async function extractAllReplies(
  page: Page,
  myHandle: string
): Promise<ExtractedReply[]> {
  const articles = await page.locator("article").all();
  const replies: ExtractedReply[] = [];

  // Skip the first article (root tweet), process the rest
  for (let i = 1; i < articles.length; i++) {
    const article = articles[i];
    if (!article) continue;

    try {
      const reply = await extractSingleReply(article, myHandle);
      if (reply) {
        replies.push(reply);
      }
    } catch {
      // Skip articles we can't parse
    }
  }

  // Build parent-child relationships by analyzing reply structure
  // X renders replies in DOM order, but we need to figure out the tree
  return buildReplyTree(replies);
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
  const permalinkId = await article.evaluate((el) => {
    const link = el.querySelector('a[href*="/status/"]');
    if (!link) return null;
    const href = link.getAttribute("href");
    const match = href?.match(/status\/(\d+)/);
    return match ? match[1] : null;
  }).catch(() => null);

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