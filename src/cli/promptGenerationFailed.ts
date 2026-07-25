import chalk from "chalk";
import { promptChoiceWithTimeout, PROMPT_TIMEOUT_MS } from "../utils/interactivePrompt";

export type GenerationFailedDecision = "myself" | "skip";

/**
 * Ask the operator what to do when no valid reply could be generated (e.g.
 * ChatGPT exhausted its 3 attempts, or a greeting/well-wish prompt timed
 * out) — rather than silently skipping, alert and let them answer it
 * themselves or explicitly skip. Skips automatically if there's no answer
 * within PROMPT_TIMEOUT_MS.
 */
export async function promptGenerationFailedDecision(
  author: string,
  tweetText: string
): Promise<GenerationFailedDecision> {
  console.log(chalk.red(`\n⚠️  Couldn't generate a valid reply for @${author}:`));
  console.log(chalk.yellow(`   "${tweetText}"\n`));
  console.log(chalk.dim(`   (no answer in ${PROMPT_TIMEOUT_MS / 1000}s — skipping automatically)`));

  return promptChoiceWithTimeout<GenerationFailedDecision>(
    "How do you want to handle this tweet?",
    [
      { title: "Answer it myself", value: "myself" },
      { title: "Skip", value: "skip" }
    ],
    "skip"
  );
}
