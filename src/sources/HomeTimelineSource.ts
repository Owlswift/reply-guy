import { Page } from "playwright";
import { extractTweets } from "../browser/extractTweets";
import { BrowserNavigator } from "../browser/BrowserNavigator";

export class HomeTimelineSource {

    name = "Home Timeline";

    async getTweets(page: Page, navigator: BrowserNavigator) {
        // Don't navigate - just extract tweets from current page
        // This allows the app to stay on the notifications page
        return extractTweets(page, "timeline");
    }
}
