import chalk from "chalk";
import { promptChoiceWithTimeout, PROMPT_TIMEOUT_MS } from "../utils/interactivePrompt";

export type ReplyDecision = "myself" | "chatgpt" | "skip" | "timeout";

/**
 * Ask the operator how to handle a tweet from a gated handle (see
 * decision/posterProfiles.ts's ALWAYS_PROMPT_HANDLES) before any reply is
 * drafted. Resolves to "timeout" (not "skip") if there's no answer within
 * the timeout — the caller should treat that as a one-off skip, since
 * explicitly choosing "Skip" is what gets remembered forever for this tweet.
 *
 * `options.timeoutMs`/`options.timeoutFallback` let a caller override the
 * default 20s/"timeout" behavior — e.g. catchupStoryTellers.ts uses a
 * shorter timeout that defaults straight to "chatgpt" instead of skipping,
 * since that command is meant to run through a long handle list mostly
 * unattended.
 */
export async function promptReplyDecision(
  author: string,
  tweetText: string,
  options?: { timeoutMs?: number | undefined; timeoutFallback?: ReplyDecision | undefined }
): Promise<ReplyDecision> {
  const timeoutMs = options?.timeoutMs ?? PROMPT_TIMEOUT_MS;
  const fallback = options?.timeoutFallback ?? "timeout";

  // Callers pass details.handle, which already includes its own leading
  // "@" (extractTweet.ts's author.match(/@\w+/)) — prepending another one
  // here produced "@@handle" in the prompt.
  console.log(chalk.magenta(`\n✋ Tweet from @${author.replace(/^@/, "")} requires a decision:`));
  console.log(chalk.yellow(`   "${tweetText}"\n`));
  const fallbackDescription = fallback === "timeout" ? "skipping automatically, but not remembered" : `defaulting to "${fallback}"`;
  console.log(chalk.dim(`   (no answer in ${timeoutMs / 1000}s — ${fallbackDescription})`));

  return promptChoiceWithTimeout<ReplyDecision>(
    "How do you want to handle this tweet?",
    [
      { title: "Answer it myself", value: "myself" },
      { title: "Pass to ChatGPT", value: "chatgpt" },
      { title: "Skip (always skip this post)", value: "skip" }
    ],
    fallback,
    timeoutMs
  );
}
