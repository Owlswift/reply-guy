import { Tweet } from "../types/tweet";

export interface TweetSource {
  fetch(): Promise<Tweet[]>;
}

// Browser-based source interface
export interface BrowserTweetSource {
  name: string;
  getTweets(page: any): Promise<any[]>;
}