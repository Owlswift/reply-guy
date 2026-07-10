import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ReplySchema, type ReplyResult } from "./schema";
import { SYSTEM_PROMPT } from "./prompt";

const client = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

/**
 * Evaluate a tweet using OpenAI's Responses API with structured outputs.
 *
 * The model is required to return a valid `ReplyResult` matching the Zod schema.
 * No manual JSON parsing — the SDK enforces the shape via `zodTextFormat`.
 *
 * @param tweet - The full text of the tweet to evaluate.
 * @returns A structured `ReplyResult` with shouldReply, confidence, reason, and reply.
 */
export async function generateReply(tweet: string): Promise<ReplyResult> {
  try {
    const response = await client.responses.parse({
      model: "gpt-4o",
      input: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: tweet,
        },
      ],
      text: {
        format: zodTextFormat(ReplySchema, "reply"),
      },
    });

    const parsed = response.output_parsed;

    if (!parsed) {
      throw new Error(
        "OpenAI returned null for structured output — this shouldn't happen with zodTextFormat.",
      );
    }

    return parsed;
  } catch (error: any) {
    console.error("OpenAI Error:", {
      status: error.status,
      code: error.code,
      type: error.type,
      message: error.message,
    });

    throw error;
  }
}