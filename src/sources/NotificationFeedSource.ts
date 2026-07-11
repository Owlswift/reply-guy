import { Page } from "playwright";
import { openNotificationFeed } from "../browser/openNotificationFeed";
import { extractTweets } from "../browser/extractTweets";

export class NotificationFeedSource {

    name = "Notifications";

    private processedTweetIds: Set<string> = new Set();
    private isActive: boolean = false;

    async getTweets(page: Page) {
        if (!this.isActive) {
            const opened = await openNotificationFeed(page);
            if (!opened) {
                return [];
            }
            this.isActive = true;
        }

        const tweets = await extractTweets(page, "notifications");
        
        // Filter out already processed tweets
        return tweets.filter(tweet => !this.processedTweetIds.has(tweet.id));
    }

    markProcessed(tweetId: string): void {
        this.processedTweetIds.add(tweetId);
    }

    isProcessed(tweetId: string): boolean {
        return this.processedTweetIds.has(tweetId);
    }

    async returnToPostsFeed(page: Page): Promise<void> {
        // Use browser history to go back to posts feed
        // This is more efficient than navigating from home
        try {
            await page.goBack({ timeout: 3000 });
            // Wait for articles to be ready
            await page.waitForSelector("article", { timeout: 5000 });
        } catch {
            // If goBack fails, we may need to reopen
            this.isActive = false;
        }
    }

    close(): void {
        this.isActive = false;
        this.processedTweetIds.clear();
    }

}