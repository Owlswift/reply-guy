import "dotenv/config";
import { getBrowserAndContext } from "./browser/browser";
import { TOP_PRIORITY_HANDLES } from "./decision/scoreTweet";
import { runCatchup } from "./catchup/runCatchup";

async function main() {
  const { context } = await getBrowserAndContext();
  await runCatchup(context, TOP_PRIORITY_HANDLES, "[Catchup]", "catchup_priority");
  process.exit(0);
}

main().catch(err => {
  console.error("[Catchup] Fatal error:", err);
  process.exit(1);
});
