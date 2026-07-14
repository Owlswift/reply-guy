import prompts from "prompts";
import chalk from "chalk";

export type ImageDecision = "myself" | "chatgpt";

/**
 * Ask the operator how to handle a tweet that contains image(s) —
 * images carry context an LLM can misread, so this is a manual gate.
 */
export async function promptImageDecision(
  author: string,
  tweetText: string,
  imageCount: number
): Promise<ImageDecision> {
  console.log(chalk.magenta(`\n🖼️  Tweet from @${author} has ${imageCount} image(s):`));
  console.log(chalk.yellow(`   "${tweetText}"\n`));

  const response = await prompts({
    type: "select",
    name: "choice",
    message: "How do you want to handle this tweet?",
    choices: [
      { title: "Answer it myself", value: "myself" },
      { title: "Pass to ChatGPT", value: "chatgpt" }
    ],
    initial: 0
  });

  // If the prompt is cancelled (e.g. Ctrl+C), default to the safer manual path
  return (response.choice as ImageDecision) ?? "myself";
}
