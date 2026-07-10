import { PipelineStage } from "../PipelineStage";
import { PipelineContext } from "../../types/context";
import { Analyzer } from "../../ai/Analyzer";
import { displayAnalysis } from "../../ui/display";

export class AnalyzeStage implements PipelineStage<PipelineContext> {
  constructor(private readonly analyzer: Analyzer) {}

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const tweet = context.tweets[context.currentIndex];

    if (!tweet) {
      return context;
    }

    const analysis = await this.analyzer.analyze(tweet);

    displayAnalysis(analysis);

    return { ...context, analysis };
  }
}