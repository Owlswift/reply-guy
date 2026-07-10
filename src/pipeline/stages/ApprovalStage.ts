import { PipelineStage } from "../PipelineStage";
import { PipelineContext } from "../../types/context";
import prompts from "prompts";

export class ApprovalStage implements PipelineStage<PipelineContext> {
  async execute(context: PipelineContext): Promise<PipelineContext> {
    const { action } = await prompts({
      type: "select",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { title: "Approve", value: "approve" },
        { title: "Edit", value: "edit" },
        { title: "Skip", value: "skip" },
        { title: "Quit", value: "quit" },
      ],
    });

    return { ...context, action };
  }
}