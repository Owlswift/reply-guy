import { PipelineStage } from "../PipelineStage";
import { PipelineContext } from "../../types/context";
import { ReplyGenerator } from "../../ai/ReplyGenerator";
import { displayDraft } from "../../ui/display";

export class DraftStage implements PipelineStage<PipelineContext> {
  constructor(private readonly replyGenerator: ReplyGenerator) {}

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const tweet = context.tweets[context.currentIndex];

    if (!tweet || !context.analysis) {
      return context;
    }

    if (!context.analysis.shouldReply) {
      console.log("\n  Skipping — not worth replying.\n");
      return { ...context, draft: null, action: "skip" };
    }

    console.log("\n  Generating draft...\n");

    const draft = await this.replyGenerator.generate(tweet, context.analysis);

    displayDraft(draft);

    return { ...context, draft };
  }
}