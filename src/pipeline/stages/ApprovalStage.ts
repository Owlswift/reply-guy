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

    if (action === "quit") {
      return { ...context, action: "quit", reply: null };
    }

    if (action === "skip") {
      return { ...context, action: "skip", reply: null };
    }

    let reply = context.draft?.reply ?? "";

    if (action === "edit") {
      const { editedReply } = await prompts({
        type: "text",
        name: "editedReply",
        message: "Edit reply:",
        initial: context.draft?.reply ?? "",
      });
      reply = editedReply;
    }

    return { ...context, action: "approve", reply };
  }
}