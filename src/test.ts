import "dotenv/config";
import { generateReply } from "./ai/openai";

async function main() {
  const result = await generateReply(
    "AI will replace software developers within five years.",
  );

  console.log(result);
}

main().catch(console.error);