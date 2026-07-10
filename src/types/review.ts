import { Draft } from "./draft";
import { Tweet } from "./tweet";

export interface ReviewItem {
  tweet: Tweet;
  draft: Draft;
}

export type ReviewAction =
  | {
      action: "approve";
      reply: string;
    }
  | {
      action: "skip";
    }
  | {
      action: "quit";
    };