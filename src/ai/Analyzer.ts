import { Tweet } from "../types/tweet";
import { AnalysisResult } from "../types/analysis";

export interface Analyzer {
  analyze(tweet: Tweet): Promise<AnalysisResult>;
}