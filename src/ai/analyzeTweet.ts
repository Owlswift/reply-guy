import ollama from "ollama";

/**
 * Two-step analysis:
 * 1. Classify the tweet type using keyword rules (fast, no model call)
 * 2. Analyze tone, core point, and best reply style using the model (only for certain types)
 */
export interface TweetAnalysis {
  type: "humor" | "story" | "opinion" | "question" | "news" | "advice" | "politics" | "sports" | "career" | "meme" | "general";
  tone: "lighthearted" | "serious" | "sarcastic" | "inspirational" | "controversial" | "neutral";
  main_point: string;
  best_reply_style: "extend" | "observe" | "question" | "add_perspective" | "react";
}

/**
 * Analyze a tweet to understand its structure and intent.
 * Uses the model for deeper understanding of tone and reply strategy.
 */
export async function analyzeTweet(tweet: string, category?: string): Promise<TweetAnalysis> {
  const categoryHint = category && category !== "general"
    ? `\nKeyword classification: ${category}`
    : "";

  const response = await ollama.chat({
    model: "gpt-oss:20b",
    options: {
      temperature: 0.3, // Lower temp for more consistent analysis
    },
    messages: [
      {
        role: "system",
        content: `
You are analyzing a tweet to help an AI write a good reply.

Output ONLY valid JSON with this structure:

{
  "type": "humor|story|opinion|question|news|advice|politics|sports|career|meme|general",
  "tone": "lighthearted|serious|sarcastic|inspirational|controversial|neutral",
  "main_point": "one sentence summary of what the tweet is actually saying or the punchline",
  "best_reply_style": "extend|observe|question|add_perspective|react"
}

Rules:

- type: what category best fits this tweet (use ${category || "general"} as hint if provided)
- tone: the emotional tone
- main_point: the actual message, joke, or hidden point — be specific
- best_reply_style: how to reply:
  - extend: continue the joke or idea
  - observe: react naturally as a friend would
  - question: ask a follow-up if appropriate
  - add_perspective: offer another angle
  - react: express a genuine reaction
`
      },
      {
        role: "user",
        content: `Tweet: ${tweet}${categoryHint}`
      }
    ]
  });

  try {
    return JSON.parse(response.message.content.trim()) as TweetAnalysis;
  } catch {
    // Fallback if JSON parsing fails
    return {
      type: "general",
      tone: "lighthearted",
      main_point: tweet,
      best_reply_style: "react"
    };
  }
}