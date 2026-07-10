import { twitter } from "./TwitterClient";

export async function reply(tweetId: string, text: string) {
  await twitter.v2.tweet(text, {
    reply: {
      in_reply_to_tweet_id: tweetId,
    },
  });
}