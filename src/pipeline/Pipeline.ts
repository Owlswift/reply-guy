import { PipelineStage } from "./PipelineStage";
import { PipelineContext } from "../types/context";

export class Pipeline {
  private stages: PipelineStage<PipelineContext>[] = [];

  addStage(stage: PipelineStage<PipelineContext>): this {
    this.stages.push(stage);
    return this;
  }

  async run(initial: PipelineContext): Promise<PipelineContext> {
    let context = initial;

    for (const stage of this.stages) {
      context = await stage.execute(context);
    }

    return context;
  }
}