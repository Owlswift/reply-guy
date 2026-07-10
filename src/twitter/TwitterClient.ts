import { TwitterApi } from "twitter-api-v2";
import "dotenv/config";

export const twitter = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_SECRET!,
  accessToken: process.env.X_ACCESS_TOKEN!,
  accessSecret: process.env.X_ACCESS_SECRET!,
});

export const twitterV2 = twitter.v2;
