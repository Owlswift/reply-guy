import { generateReply } from "./ollama";

async function main() {
  const reply = await generateReply(
    "AI is replacing repetitive work much faster than people expected."
  );

  console.log(reply);
}

main();