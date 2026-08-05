import { Page } from "playwright";

/**
 * Like a specific reply on its own permalink page — used for conversation
 * closers ("fr", "exactly", "yes"), which deserve a like and nothing else.
 *
 * `likeTweetOnFeed` in startSearch.ts handles timeline cards; this handles
 * the permalink pages opened by engage.ts / notifications.ts, where the
 * article is the only one on the page.
 */
export async function likeReplyOnPage(page: Page, replyId: string): Promise<boolean> {
  try {
    // Already liked — X swaps the testid once liked, so if unlike is
    // visible there's nothing to do.
    const unlikeButton = page.locator(`[data-testid="unlike"]`).first();
    if (await unlikeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }

    const likeButton = page.locator(`[data-testid="like"]`).first();
    if (!(await likeButton.isVisible({ timeout: 3000 }).catch(() => false))) {
      return false;
    }

    await likeButton.click({ timeout: 5000 });
    return true;
  } catch (err) {
    console.log(`  ⚠️ Could not like reply ${replyId}: ${err}`);
    return false;
  }
}