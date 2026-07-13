export interface Tweet {
  id: string;
  authorId: string;
  authorHandle: string;
  text: string;
  createdAt: Date;
}

export type TweetSourceType = "notifications" | "timeline" | "watchlist";

export interface TimelineTweet {
  id: string;
  author: string;
  username: string;
  text: string;
  url: string;
  verified: boolean;
  following: boolean;
  followsYou: boolean;
  likes: number;
  replies: number;
  reposts: number;
  source: TweetSourceType;
  createdAt: Date;
}
