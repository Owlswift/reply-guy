import { Page } from "playwright";

/**
 * Open the reply composer.
 *
 * By default clicks the first reply button on the page — correct when the
 * page was navigated directly to the tweet being replied to (it's the only
 * or first article there). When replying to a reply-to-a-reply, though, X's
 * permalink page renders the ancestor tweet(s) above the target reply, so
 * the page-wide first reply button belongs to the ancestor, not the target.
 * Pass targetTweetId in that case to scope the click to the article whose
 * own permalink matches it.
 */
export async function openReplyBox(page: Page, targetTweetId?: string): Promise<void> {
  // First, dismiss any open modals (image viewer, login popup, etc.)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  let replyButton = page.locator('[data-testid="reply"]').first();

  if (targetTweetId) {
    const articles = page.locator("article");
    const count = await articles.count();
    for (let i = 0; i < count; i++) {
      const article = articles.nth(i);
      const isTarget = await article.evaluate((el, id) => {
        const link = el.querySelector(`a[href*="/status/${id}"]`);
        return !!link;
      }, targetTweetId).catch(() => false);
      if (isTarget) {
        replyButton = article.locator('[data-testid="reply"]').first();
        break;
      }
    }
  }

  await replyButton.click({ timeout: 10000 });

  await page.waitForSelector(
    '[data-testid="tweetTextarea_0"]',
    { timeout: 10000 }
  );
}