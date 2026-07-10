import { Tweet } from "../types/tweet";
import { AnalysisResult } from "../types/analysis";
import { Draft } from "../types/draft";

export interface ReplyGenerator {
  generate(tweet: Tweet, analysis: AnalysisResult): Promise<Draft>;
}