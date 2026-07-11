import { Page } from "playwright";

export async function expandTweet(page: Page) {
    const articles = await page.locator("article").all();
    
    for (const article of articles) {
        const showMore = article.getByText("Show more", { exact: true });
        const count = await showMore.count();
        
        for (let i = 0; i < count; i++) {
            try {
                await showMore.nth(i).click();
                await page.waitForTimeout(300);
            } catch {
                // Ignore errors if click fails
            }
        }
    }
}