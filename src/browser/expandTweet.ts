import { Page } from "playwright";

export async function expandTweet(page: Page) {
    console.log("[expandTweet] Looking for 'Show more' links...");
    
    // Find all articles first
    const articles = await page.locator("article").all();
    console.log(`[expandTweet] Found ${articles.length} articles`);
    
    let totalClicked = 0;

    for (const article of articles) {
        // Search for "Show more" within each article
        const showMore = article.getByText("Show more", { exact: true });
        const count = await showMore.count();
        
        if (count > 0) {
            console.log(`[expandTweet] Found ${count} 'Show more' links in article`);
            
            for (let i = 0; i < count; i++) {
                try {
                    console.log(`[expandTweet] Clicking 'Show more' link ${i + 1} in article...`);
                    await showMore.nth(i).click();
                    await page.waitForTimeout(300);
                    totalClicked++;
                    console.log(`[expandTweet] Clicked 'Show more' link ${i + 1} in article`);
                } catch (err) {
                    console.log(`[expandTweet] Failed to click 'Show more' link ${i + 1} in article: ${err}`);
                    // Ignore errors if click fails
                }
            }
        }
    }
    
    console.log(`[expandTweet] Done expanding tweets, clicked ${totalClicked} 'Show more' links`);
}