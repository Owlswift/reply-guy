import { runAIWorker } from "./workers/aiWorker";
import { runBrowserWorker } from "./workers/browserWorker";
import { createNavigator } from "./browser/BrowserNavigator";

async function main() {
  // Get the page for workers that need it
  const { getPage } = await import("./browser/browser");
  const page = await getPage();
  const navigator = createNavigator(page);

  // Start workers
  // NOTE: runTimelineWorker is disabled — it navigated to /home and caused race conditions.
  // The bot runs as a single-threaded pipeline. See src/main-interactive.ts.
  runAIWorker();
  runBrowserWorker(page, navigator);
}

main().catch(console.error);
