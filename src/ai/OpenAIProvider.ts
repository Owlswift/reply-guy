import { Analyzer } from "./Analyzer";
import { ReplyGenerator } from "./ReplyGenerator";
import { Tweet } from "../types/tweet";
import { AnalysisResult } from "../types/analysis";
import { Draft } from "../types/draft";
import OpenAI from "openai";

export class OpenAIProvider implements Analyzer, ReplyGenerator {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async analyze(tweet: Tweet): Promise<AnalysisResult> {
    const response = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Analyze this tweet and determine if it's worth replying to. Consider if it's a technical question, discussion, or debate. Return JSON with shouldReply (boolean), confidence (0-100), and reason (string).",
        },
        {
          role: "user",
          content: tweet.text,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content || "{}";
    const result = JSON.parse(content);

    return {
      tweetId: tweet.id,
      shouldReply: result.shouldReply ?? true,
      confidence: result.confidence ?? 50,
      reason: result.reason ?? "No reason provided",
    };
  }

  async generate(tweet: Tweet, analysis: AnalysisResult): Promise<Draft> {
    const response = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Generate a thoughtful, concise reply to this tweet. Keep it under 280 characters. Be helpful and engaging.",
        },
        {
          role: "user",
          content: `Tweet: ${tweet.text}\n\nReason for replying: ${analysis.reason}`,
        },
      ],
    });

    const reply = response.choices[0]?.message?.content ?? "";

    return {
      tweetId: tweet.id,
      reply,
    };
  }
}