import { Draft } from "./draft";
import { Tweet } from "./tweet";

export interface ReviewItem {
  tweet: Tweet;
  draft: Draft;
}
