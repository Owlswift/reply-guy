import { Draft } from "../types/draft";
import { Tweet } from "../types/tweet";

export interface AIProvider {
  generate(tweet: Tweet): Promise<Draft>;
}