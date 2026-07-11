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

            try {

                const result =
                    await source.getTweets(page);

                tweets.push(...result);

            } catch (err) {

                console.error(
                    `${source.name} failed`,
                    err
                );

            }

        }

        return tweets;

    }

}