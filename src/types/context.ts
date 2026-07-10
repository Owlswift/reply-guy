import { Tweet } from "./tweet";
import { AnalysisResult } from "./analysis";
import { Draft } from "./draft";

export interface PipelineContext {
  tweets: Tweet[];
  currentIndex: number;
  analysis: AnalysisResult | null;
  draft: Draft | null;
  action: "approve" | "edit" | "skip" | "quit" | null;
  reply: string | null;
}