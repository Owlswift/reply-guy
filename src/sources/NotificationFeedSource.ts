import { Page } from "playwright";
import { extractTweets } from "../browser/extractTweets";
import { BrowserNavigator } from "../browser/BrowserNavigator";
import { getNewestTweetId, setNewestTweetId } from "../timeline/state";
import { TimelineTweet } from "../types/tweet";
import { log } from "../utils/logger";

export class NotificationFeedSource {

    name = "Notifications";

    private isActive: boolean = false;

    /**
     * Fetch notifications from the feed.
     * 
     * When incremental is true, only returns tweets that are newer than
     * the newest tweet we've already seen. This is used for the quick
     * "check for new notifications between replies" phase (PHASE 5).
     * 
     * When incremental is false (default), returns ALL visible tweets.
     * This is the normal mode for the main watch loop (PHASE 1).
     */
    async getTweets(page: Page, navigator: BrowserNavigator, incremental: boolean = false): Promise<TimelineTweet[]> {
        if (!this.isActive) {
            const opened = await navigator.openNotificationFeed();
            if (!opened) {
                return [];
            }
            this.isActive = true;
        }

        const tweets = await extractTweets(page, "notifications");

        if (!incremental) {
            // Normal mode: return all visible tweets
            return tweets;
        }

        // Incremental mode: only return tweets newer than our last seen
        const newestId = getNewestTweetId();
        if (!newestId) {
            // No baseline yet — record and return all
            this.recordNewest(tweets);
            return tweets;
        }

        // Filter to only tweets that are newer than the last seen
        const newTweets = tweets.filter(t => t.id > newestId);

        if (newTweets.length > 0) {
            log(`[Timeline] Found ${newTweets.length} new tweet(s) above ${newestId}`);
            this.recordNewest(newTweets);
        }

        return newTweets;
    }

    /**
     * Record the newest tweet ID from a batch of tweets.
     */
    private recordNewest(tweets: TimelineTweet[]): void {
        for (const t of tweets) {
            setNewestTweetId(t.id);
        }
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