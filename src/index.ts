import { MockAI } from "./ai/MockAI";
import { MockSource } from "./sources/MockSource";
import { TweetProcessor } from "./services/TweetProcessor";

async function main() {
  const source = new MockSource();
  const ai = new MockAI();

  const processor = new TweetProcessor(source, ai);

  await processor.run();
}

main().catch(console.error);