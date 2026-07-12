import { Page } from "playwright";

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // Use page.evaluate so we never have a hanging locator
    const hasButton = await page.evaluate(
      `!!document.querySelector('[data-testid="SideNav_NewTweet_Button"]')`,
      { timeout: 8_000 }
    );
    return hasButton as boolean;
  } catch {
    return false;
  }
}