import { buildPrompt, PromptInput } from "./buildPrompt";
import { Relationship } from "../relationship/types";
import { ReplyMemory } from "../types/memory";

const OLLAMA_URL = "http://localhost:11434/api/generate";

export async function generateReply(
  input: PromptInput | string,
  relationship: Relationship = "stranger",
  memories: ReplyMemory[] = []
) {
  // Support both old and new API
  const prompt = typeof input === "string"
    ? buildPrompt({ tweet: input, relationship, memories })
    : buildPrompt(input);

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-oss:20b",
      stream: false,
      prompt,
    }),
  });

  const data = await response.json() as { response: string };

  return data.response.trim();
}