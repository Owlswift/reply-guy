import { Page } from "playwright";
import { openNotificationFeed } from "../browser/openNotificationFeed";
import { extractTweets } from "../browser/extractTweets";
import { markNotificationSeen, isNotificationSeen } from "../storage/seenNotifications";

export class NotificationFeedSource {

    name = "Notifications";

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
        
        // Filter out already processed tweets using persistent storage
        return tweets.filter(tweet => !isNotificationSeen(tweet.id));
    }

    markProcessed(tweetId: string, tweetUrl: string): void {
        markNotificationSeen(tweetId, tweetUrl);
    }

    isProcessed(tweetId: string): boolean {
        return isNotificationSeen(tweetId);
    }

    async returnToPostsFeed(page: Page): Promise<void> {
        // Navigate directly to the filtered posts timeline
        try {
            await page.goto("https://x.com/i/timeline", { waitUntil: "domcontentloaded", timeout: 10000 });
            // Wait for articles to be ready
            await page.waitForSelector("article", { timeout: 5000 });
        } catch {
            // If navigation fails, we may need to reopen
            this.isActive = false;
        }
    }

    close(): void {
        this.isActive = false;
    }

}
