import chalk from "chalk";
import { promptChoiceWithTimeout, PROMPT_TIMEOUT_MS } from "../utils/interactivePrompt";

export type ImageDecision = "myself" | "chatgpt" | "skip";

/**
 * Ask the operator how to handle a tweet that contains image(s) —
 * images carry context an LLM can misread, so this is a manual gate.
 * Skips automatically if there's no answer within PROMPT_TIMEOUT_MS.
 */
export async function promptImageDecision(
  author: string,
  tweetText: string,
  imageCount: number
): Promise<ImageDecision> {
  console.log(chalk.magenta(`\n🖼️  Tweet from @${author} has ${imageCount} image(s):`));
  console.log(chalk.yellow(`   "${tweetText}"\n`));
  console.log(chalk.dim(`   (no answer in ${PROMPT_TIMEOUT_MS / 1000}s — skipping automatically)`));

  return promptChoiceWithTimeout<ImageDecision>(
    "How do you want to handle this tweet?",
    [
      { title: "Answer it myself", value: "myself" },
      { title: "Pass to ChatGPT", value: "chatgpt" }
    ],
    "skip"
  );
}
