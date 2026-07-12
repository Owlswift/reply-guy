import ollama from "ollama";

export interface TweetUnderstanding {
  type: string;
  tone: string;
  topic: string;
  intent: string;
  why_people_like_it: string;
  best_reply_strategy: string;
}

/**
 * Step 1: Understand the tweet deeply before replying.
 * 
 * This gives the model a structured understanding of what it's replying to,
 * rather than jumping straight to generation.
 */
export async function understandTweet(tweet: string, author?: string): Promise<TweetUnderstanding> {
  const response = await ollama.chat({
    model: "gpt-oss:20b",
    options: {
      temperature: 0.2, // Low temp for consistent analysis
    },
    messages: [
      {
        role: "system",
        content: `
Analyze this tweet.

Return JSON only.

{
  "type": "",
  "tone": "",
  "topic": "",
  "intent": "",
  "why_people_like_it": "",
  "best_reply_strategy": ""
}

Fields:

- type: humor, story, opinion, question, news, advice, politics, sports, career, meme, announcement, or general
- tone: lighthearted, serious, sarcastic, inspirational, controversial, neutral, playful, frustrated
- topic: the subject matter (e.g. "writing", "football", "tech", "relationships")
- intent: why the author posted this (e.g. "make people laugh", "share frustration", "ask for advice", "start a discussion")
- why_people_like_it: what makes this tweet engaging or shareable
- best_reply_strategy: extend_joke, add_perspective, make_observation, share_experience, challenge_idea, complete_thought, react_naturally

Output ONLY the JSON. No explanation.
`
      },
      {
        role: "user",
        content: `Tweet: ${tweet}${author ? `\nAuthor: @${author}` : ""}`
      }
    ]
  });

  try {
    return JSON.parse(response.message.content.trim()) as TweetUnderstanding;
  } catch {
    return {
      type: "general",
      tone: "neutral",
      topic: "general",
      intent: "share something",
      why_people_like_it: "relatable",
      best_reply_strategy: "react_naturally"
    };
  }
}