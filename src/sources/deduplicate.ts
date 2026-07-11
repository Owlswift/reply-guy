import { TimelineTweet } from "../types/tweet";

export function deduplicateTweets(
    tweets: TimelineTweet[]
): TimelineTweet[] {

    const map =
        new Map<string, TimelineTweet>();

    for (const tweet of tweets) {

        map.set(tweet.id, tweet);

    }

    return [...map.values()];

}