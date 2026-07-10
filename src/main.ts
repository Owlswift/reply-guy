import { MockSource } from "./sources/MockSource";
import { MockAnalyzer } from "./ai/MockAnalyzer";
import { MockReplyGenerator } from "./ai/MockReplyGenerator";
import { Pipeline } from "./pipeline/Pipeline";
import { FetchStage } from "./pipeline/stages/FetchStage";
import { AnalyzeStage } from "./pipeline/stages/AnalyzeStage";
import { DraftStage } from "./pipeline/stages/DraftStage";
import { ApprovalStage } from "./pipeline/stages/ApprovalStage";
import { displayHeader, displayTweet } from "./ui/display";
import { PipelineContext } from "./types/context";

async function main() {
  const source = new MockSource();
  const analyzer = new MockAnalyzer();
  const replyGenerator = new MockReplyGenerator();

  // Fetch all tweets first
  const fetchStage = new FetchStage(source);
  const { tweets } = await fetchStage.execute({
    tweets: [],
    currentIndex: 0,
    analysis: null,
    draft: null,
    action: null,
  });

  displayHeader(tweets);

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i]!;
    displayTweet(tweet, i + 1, tweets.length);

    const pipeline = new Pipeline()
      .addStage(new AnalyzeStage(analyzer))
      .addStage(new DraftStage(replyGenerator))
      .addStage(new ApprovalStage());

    const context: PipelineContext = {
      tweets,
      currentIndex: i,
      analysis: null,
      draft: null,
      action: null,
    };

    const result = await pipeline.run(context);

    if (result.action === "quit") {
      console.log("\n  Exiting.\n");
      break;
    }

    console.log(`  → ${result.action}\n`);
  }
}

main().catch(console.error);