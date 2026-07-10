import { TweetSource } from "./TweetSource";
import { Tweet } from "../types/tweet";
import { twitter } from "../twitter/TwitterClient";

export class TwitterSource implements TweetSource {
  async fetch(): Promise<Tweet[]> {
    // Use v1.1 API for mentions (free tier)
    const mentions = await twitter.v1.mentionTimeline({ count: 10 });

    return mentions.tweets.map((tweet) => ({
      id: tweet.id_str,
      authorId: tweet.user.id_str,
      authorHandle: tweet.user.screen_name,
      text: tweet.text,
      createdAt: new Date(tweet.created_at),
    }));
  }
}
