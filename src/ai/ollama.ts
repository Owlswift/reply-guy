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
  const promptResult = typeof input === "string"
    ? await buildPrompt({ tweet: input, relationship, memories })
    : await buildPrompt(input);

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-oss:20b",
      stream: false,
      prompt: promptResult.prompt,
      options: {
        temperature: 0.7,
        top_p: 0.9,
        repeat_penalty: 1.1,
      },
    }),
  });

  const data = await response.json() as { response: string };

  return data.response.trim();
}

/**
 * Generate 3 candidate replies and return the best one.
 * This improves quality by letting the model try different approaches.
 */
export async function generateBestReply(
  input: PromptInput | string,
  relationship: Relationship = "stranger",
  memories: ReplyMemory[] = []
): Promise<string> {
  const candidates: string[] = [];
  
  for (let i = 0; i < 3; i++) {
    const reply = await generateReply(input, relationship, memories);
    if (reply && reply.length > 0) {
      candidates.push(reply);
    }
  }
  
  // If we got candidates, pick the one that's not a duplicate and not too short
  // For now, just return the first valid one
  return candidates[0] ?? "";
}
