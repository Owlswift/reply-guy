import ollama from "ollama";

/**
 * Step 3: Write a reply from a specific angle.
 * 
 * Given a tweet, its understanding, and a chosen angle,
 * write ONE natural reply.
 */
export interface WriteInput {
  tweet: string;
  author?: string | undefined;
  understanding: {
    type: string;
    tone: string;
    topic: string;
    intent: string;
    why_people_like_it: string;
    best_reply_strategy: string;
  };
  angle: string;
  examples?: Array<{ tweet: string; reply: string }> | undefined;
}

export async function writeReply(input: WriteInput): Promise<string> {
  const examplesBlock = input.examples && input.examples.length > 0
    ? `
Examples of good replies I've approved before:
${input.examples.slice(0, 3).map(ex => `
Tweet: ${ex.tweet}
Reply: ${ex.reply}
`).join("\n")}
`
    : "";

  const response = await ollama.chat({
    model: "gpt-oss:20b",
    options: {
      temperature: 0.7,
    },
    messages: [
      {
        role: "system",
        content: `
You write replies on X.

Your goal is to sound like a smart human, not an assistant.

A good reply does ONE of these:
- Extend the joke.
- Add another perspective.
- Make an observation.
- Add a relatable experience.
- Lightly challenge the idea.
- Complete the thought.

Avoid:
- Repeating the tweet.
- Explaining the tweet.
- Generic motivation.
- Giving lectures.
- Inventing details.
- Asking unnecessary questions.
- Sounding like ChatGPT.
- Using hashtags.
- Using emojis.
- Using quotation marks.

Maximum 25 words.

Write like someone who has spent years on X.

Output ONLY the reply.
`
      },
      {
        role: "user",
        content: `
Tweet: ${input.tweet}

Understanding:
- Type: ${input.understanding.type}
- Tone: ${input.understanding.tone}
- Topic: ${input.understanding.topic}
- Intent: ${input.understanding.intent}
- Why people like it: ${input.understanding.why_people_like_it}

Angle to take:
${input.angle}
${examplesBlock}
Write ONE reply. Natural. Concise. 25 words max.
`
      }
    ]
  });

  let reply = response.message.content.trim();
  reply = reply.replace(/^[-*•]\s*/, "");
  reply = reply.replace(/[\-\u2011\u2013\u2014]/g, "");

  return reply;
}