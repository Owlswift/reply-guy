import { AIProvider } from "../ai/AIProvider";
import { TweetSource } from "../sources/TweetSource";
import { printDraft, printTweet } from "../utils/formatter";
import { ApprovalService } from "../approval/ApprovalService";

export class TweetProcessor {
  constructor(
    private readonly source: TweetSource,
    private readonly ai: AIProvider,
  ) {}

  async run() {
    const tweets = await this.source.fetch();

    console.log(`Found ${tweets.length} tweets\n`);

    const approval = new ApprovalService();

    for (const tweet of tweets) {
      printTweet(tweet);

      const draft = await this.ai.generate(tweet);

      printDraft(draft);

      const action = await approval.review();
      console.log(`→ ${action.action}\n`);
    }
  }
}