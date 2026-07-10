import { Tweet } from "../types/tweet";

export interface TweetSource {
  fetch(): Promise<Tweet[]>;
}