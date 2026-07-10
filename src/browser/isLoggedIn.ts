import { Page } from "playwright";

export async function isLoggedIn(page: Page): Promise<boolean> {
  return await page
    .locator('[data-testid="SideNav_NewTweet_Button"]')
    .isVisible()
    .catch(() => false);
}