import chalk from "chalk";
import { promptChoiceWithTimeout, PROMPT_TIMEOUT_MS } from "../utils/interactivePrompt";

export type ImageDecision = "myself" | "chatgpt" | "skip";

/**
 * Ask the operator how to handle a tweet that contains media (image,
 * video, or GIF) — media carries context an LLM can misread, so this is a
 * manual gate. Skips automatically if there's no answer within timeoutMs
 * (default PROMPT_TIMEOUT_MS, overridable — e.g. main-interactive.ts uses a
 * shorter 10s for this specific prompt).
 *
 * `mediaLabel` is a caller-built description of what's actually attached
 * (e.g. "2 image(s)", "a video", "2 image(s) and a video") — kept generic
 * here rather than a raw count so this isn't tied to images specifically.
 */
export async function promptImageDecision(
  author: string,
  tweetText: string,
  mediaLabel: string,
  timeoutMs: number = PROMPT_TIMEOUT_MS
): Promise<ImageDecision> {
  console.log(chalk.magenta(`\n🖼️  Tweet from @${author} has ${mediaLabel}:`));
  console.log(chalk.yellow(`   "${tweetText}"\n`));
  console.log(chalk.dim(`   (no answer in ${timeoutMs / 1000}s — skipping automatically)`));

  return promptChoiceWithTimeout<ImageDecision>(
    "How do you want to handle this tweet?",
    [
      { title: "Answer it myself", value: "myself" },
      { title: "Pass to ChatGPT", value: "chatgpt" }
    ],
    "skip",
    timeoutMs
  );
}
