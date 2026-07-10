import { buildPrompt } from "./buildPrompt";
import { Relationship } from "../relationship/types";

const OLLAMA_URL = "http://localhost:11434/api/generate";

export async function generateReply(tweet: string, relationship: Relationship = "stranger") {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3:8b",
      stream: false,
      prompt: buildPrompt(tweet, relationship),
    }),
  });

  const data = await response.json() as { response: string };

  return data.response.trim();
}