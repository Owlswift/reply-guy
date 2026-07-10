import { ReviewItem, ReviewAction } from "../types/review";
import { displayDraft, displayTweet } from "../ui/display";
import prompts from "prompts";

export class ReviewService {
  async review(items: ReviewItem[]): Promise<ReviewAction[]> {
    const actions: ReviewAction[] = [];

    for (const item of items) {
      console.clear();

      displayTweet(item.tweet, 0, 0);
      displayDraft(item.draft);

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
        actions.push({ action: "quit" });
        break;
      }

      if (action === "skip") {
        actions.push({ action: "skip" });
        continue;
      }

      let reply = item.draft.reply;

      if (action === "edit") {
        const { editedReply } = await prompts({
          type: "text",
          name: "editedReply",
          message: "Edit reply:",
          initial: item.draft.reply,
        });
        reply = editedReply;
      }

      actions.push({
        action: "approve",
        reply,
      });
    }

    return actions;
  }
}