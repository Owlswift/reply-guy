import prompts from "prompts";

export class ApprovalService {
  async review() {
    return prompts({
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
  }
}