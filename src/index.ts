import { runAIWorker } from "./workers/aiWorker";
import { runBrowserWorker } from "./workers/browserWorker";
import { runTimelineWorker } from "./workers/timelineWorker";

async function main() {
  // Get the page for workers that need it
  const { getPage } = await import("./browser/browser");
  const page = await getPage();

  // Start all workers
  runTimelineWorker(page);
  runAIWorker(page);
  runBrowserWorker(page);
}

main().catch(console.error);