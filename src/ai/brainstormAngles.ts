import ollama from "ollama";

/**
 * Step 2: Brainstorm reply angles before writing.
 * 
 * Instead of "write a reply", we generate ideas first.
 * Each idea is an angle, not a full reply.
 */
export async function brainstormAngles(
  tweet: string,
  understanding: { type: string; tone: string; topic: string; intent: string; best_reply_strategy: string },
  count: number = 10
): Promise<string[]> {
  const response = await ollama.chat({
    model: "gpt-oss:20b",
    options: {
      temperature: 0.8, // Higher temp for variety
    },
    messages: [
      {
        role: "system",
        content: `
You are brainstorming reply angles for a tweet.

Generate ${count} reply ideas.

These are ANGLES, not full replies.

Each idea should be 2-6 words describing an approach.

Examples:

Tweet: "If your hooks aren't hooking, stop writing essays."

Ideas:
1. Continue the joke about pain relievers
2. Mention "Show More" button trap
3. Mention comment investigators
4. Mention reading twice
5. Use Nigerian Pidgin to match energy
6. Compare it to food analogies
7. Short and direct agreement
8. Add personal writing experience
9. Mention Panadol
10. Lightly challenge the premise

Output each idea on a separate line.

No numbers, no bullet points, no explanations.

Just the ideas.
`
      },
      {
        role: "user",
        content: `
Tweet: ${tweet}

Analysis:
Type: ${understanding.type}
Tone: ${understanding.tone}
Topic: ${understanding.topic}
Intent: ${understanding.intent}
Strategy: ${understanding.best_reply_strategy}

Generate ${count} reply angles:
`
      }
    ]
  });

  const content = response.message.content.trim();
  // Parse lines — strip numbers, bullets, dashes
  const angles = content
    .split("\n")
    .map(line => line.replace(/^[\d\-*•.\s]+/, "").trim())
    .filter(line => line.length > 3);

  return angles.slice(0, count);
}