import { Page } from "playwright";

export async function expandTweet(page: Page) {
    const buttons = page.getByText("Show more", { exact: true });

    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
        try {
            await buttons.nth(i).click();
            await page.waitForTimeout(300);
        } catch {
            // Ignore errors if click fails
        }
    }
}