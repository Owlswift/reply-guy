import { TweetDetails } from "./extractTweet";
import OpenAI from "openai";
import "dotenv/config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateReply(tweet: TweetDetails): Promise<string> {
  // If no API key or quota issue, return a mock reply for testing
  if (!process.env.OPENAI_API_KEY) {
    return `This is a thoughtful reply to ${tweet.handle}'s post about "${tweet.text.slice(0, 50)}..."`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are writing thoughtful replies on X. Write ONE concise reply. Keep it under 280 characters. Be helpful and engaging.",
        },
        {
          role: "user",
          content: `Tweet: ${tweet.text}\n\nWrite a thoughtful reply.`,
        },
      ],
    });

    return response.choices[0]?.message?.content ?? "";
  } catch (error) {
    // Fallback to mock reply on API errors
    console.log("OpenAI error, using mock reply:", error);
    return `This is a thoughtful reply to ${tweet.handle}'s post about "${tweet.text.slice(0, 50)}..."`;
  }
}