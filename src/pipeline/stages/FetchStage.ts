import { PipelineStage } from "../PipelineStage";
import { PipelineContext } from "../../types/context";
import { TweetSource } from "../../sources/TweetSource";

export class FetchStage implements PipelineStage<PipelineContext> {
  constructor(private readonly source: TweetSource) {}

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const tweets = await this.source.fetch();
    return { ...context, tweets, currentIndex: 0 };
  }
}