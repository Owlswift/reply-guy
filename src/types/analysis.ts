export type TweetCategory =
  | "humor"
  | "story"
  | "opinion"
  | "question"
  | "news"
  | "advice"
  | "politics"
  | "sports"
  | "career"
  | "meme"
  | "general"
  | "well_wish"
  | "greeting";

export type ReplyStyle =
  | "extend"
  | "observe"
  | "question"
  | "add_perspective"
  | "react";

export interface AnalysisResult {
  tweetId: string;
  shouldReply: boolean;
  confidence: number;
  reason: string;
  category?: TweetCategory;
  tone?: string;
  core_point?: string;
  reply_style?: ReplyStyle;
}