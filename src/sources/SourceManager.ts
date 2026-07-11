import { Page } from "playwright";
import { TimelineTweet } from "../types/tweet";

interface Source {
    name: string;
    getTweets(page: Page): Promise<TimelineTweet[]>;
}

export class SourceManager {

    constructor(
        private readonly sources: Source[]
    ) {}

    async getTweets(
        page: Page
    ): Promise<TimelineTweet[]> {

        const tweets: TimelineTweet[] = [];

        for (const source of this.sources) {

            console.log(`[SourceManager] Checking ${source.name}...`);

            try {

                const result =
                    await source.getTweets(page);

                console.log(
                    `[SourceManager] ${source.name}: ${result.length} tweets`
                );

                tweets.push(...result);

            } catch (err) {

                console.error(
                    `[SourceManager] ${source.name} failed`,
                    err
                );

            }

        }

        return tweets;

    }

}