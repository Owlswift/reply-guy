import { Page } from "playwright";
import { extractTweets } from "../browser/extractTweets";

export class HomeTimelineSource {

    name = "Home Timeline";

    async getTweets(page: Page) {

        await page.goto("https://x.com/home");

        return extractTweets(page, "timeline");

    }
}