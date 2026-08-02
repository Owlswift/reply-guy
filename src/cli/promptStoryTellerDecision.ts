import chalk from "chalk";
import { promptChoiceWithTimeout } from "../utils/interactivePrompt";

export type StoryTellerDecision = "push" | "skip";

const DECISION_TIMEOUT_MS = 20_000;

/**
 * Ask the operator whether to add a thread's author to the story-teller
 * handle list (storage/storyTellerHandles.ts) — used by startSearch.ts,
 * which only ever discovers candidates, never posts anything itself.
 * Skips automatically if there's no answer within 20s.
 */
export async function promptStoryTellerDecision(
  author: string,
  tweetText: string
): Promise<StoryTellerDecision> {
  console.log(chalk.magenta(`\n🧵 Tweet from @${author} looks like a thread/story:`));
  console.log(chalk.yellow(`   "${tweetText}"\n`));
  console.log(chalk.dim(`   (no answer in ${DECISION_TIMEOUT_MS / 1000}s — skipping automatically)`));

  return promptChoiceWithTimeout<StoryTellerDecision>(
    `Push @${author} to the story-tellers cache?`,
    [{ title: "Push", value: "push" }],
    "skip",
    DECISION_TIMEOUT_MS
  );
}
