import ollama from "ollama";

export interface TweetAnalysis {
  type: "humor" | "story" | "opinion" | "question" | "news" | "advice" | "general";
  tone: "lighthearted" | "serious" | "sarcastic" | "inspirational" | "controversial";
  core_point: string;
  best_reply_style: "extend" | "observe" | "question" | "add_perspective" | "react";
}

/**
 * Analyze a tweet to understand its structure and intent.
 * This helps GPT-OSS generate more relevant replies.
 */
export async function analyzeTweet(tweet: string): Promise<TweetAnalysis> {
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
  "type": "humor|story|opinion|question|news|advice|general",
  "tone": "lighthearted|serious|sarcastic|inspirational|controversial",
  "core_point": "one sentence summary of what the tweet is actually saying",
  "best_reply_style": "extend|observe|question|add_perspective|react"
}

Rules:

- type: what category best fits this tweet
- tone: the emotional tone
- core_point: the actual message or punchline
- best_reply_style: how to reply (extend the joke, observe, ask question, add perspective, or react naturally)
`
      },
      {
        role: "user",
        content: `Tweet: ${tweet}`
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
      core_point: tweet,
      best_reply_style: "react"
    };
  }
}