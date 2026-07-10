export interface PipelineStage<TInput, TOutput = TInput> {
  execute(input: TInput): Promise<TOutput>;
}