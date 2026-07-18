import { Page } from "playwright";
import { expandTweet } from "./expandTweet";

export interface TweetDetails {
  author: string;
  handle: string;
  text: string;
  fullText: string;
  url: string;
  imageUrls: string[];
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

  // The anchor is whichever tweet the page opened to — X scrolls the
  // permalink page to center this tweet, and it's the one the reply button
  // targets, regardless of where it sits in a longer thread.
  const anchorArticle = articles[0];
  if (!anchorArticle) {
    return null;
  }

  const anchor = await readArticle(anchorArticle);
  if (!anchor) {
    return null;
  }
  const rootHandle = anchor.handle;

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
  const record = (text: string) => {
    if (!text || seenTexts.has(text)) return;
    seenTexts.add(text);
    threadTexts.push(text);
  };
  record(anchor.text);

  for (let i = 1; i < articles.length; i++) {
    const article = articles[i];
    if (!article) break;
    const parsed = await readArticle(article);
    if (!parsed || parsed.handle !== rootHandle) break;
    if (Math.abs(parsed.time - anchor.time) > TIME_WINDOW_MS) break;
    record(parsed.text);
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
    imageUrls
  };
}
