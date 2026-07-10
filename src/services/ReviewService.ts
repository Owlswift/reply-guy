import { ReviewItem } from "../types/review";
import { displayDraft, displayTweet } from "../ui/display";

export class ReviewService {
  async review(items: ReviewItem[]): Promise<void> {
    for (const item of items) {
      console.clear();

      displayTweet(item.tweet, 0, 0);
      displayDraft(item.draft);

      console.log("\n  Press ENTER to continue...");
      await this.waitForEnter();
    }
  }

  private waitForEnter(): Promise<void> {
    return new Promise((resolve) => {
      process.stdin.once("data", () => resolve());
    });
  }
}
