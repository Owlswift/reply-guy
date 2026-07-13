import { Page } from "playwright";
import { extractTweets } from "../browser/extractTweets";
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
        
        // Return ALL notifications from the feed.
        // The main loop handles deduplication by checking the queue and
        // replied-tweets storage. We don't filter here because a tweet
        // may have been enqueued but skipped (e.g. shouldSkipTweet),
        // and we want to give it another chance if it's still visible.
        return tweets;
    }

    async returnToPostsFeed(navigator: BrowserNavigator): Promise<void> {
        // Use browser back button to return to notifications.
        // Since we opened a tweet from the notifications page, goBack()
        // returns us to exactly where we were — no server-side redirect.
        try {
            await navigator.goBack();
        } catch {
            // If back fails, we may need to reopen
            this.isActive = false;
        }
    }

    close(): void {
        this.isActive = false;
    }

}