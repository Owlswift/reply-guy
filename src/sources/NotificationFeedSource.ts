import { Page } from "playwright";
import { extractTweets } from "../browser/extractTweets";
import { markNotificationSeen, isNotificationSeen } from "../storage/seenNotifications";
import { BrowserNavigator } from "../browser/BrowserNavigator";

export class NotificationFeedSource {

    name = "Notifications";

    private isActive: boolean = false;

    async getTweets(page: Page, navigator: BrowserNavigator) {
        if (!this.isActive) {
            const opened = await navigator.openNotificationFeed();
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

    async returnToPostsFeed(navigator: BrowserNavigator): Promise<void> {
        // Navigate directly to the filtered posts timeline
        try {
            await navigator.navigateToTimeline();
            // Note: Cannot wait for selector here as we don't have page access
        } catch {
            // If navigation fails, we may need to reopen
            this.isActive = false;
        }
    }

    close(): void {
        this.isActive = false;
    }

}
