import ollama from "ollama";

export interface JudgedReply {
  reply: string;
  worthPosting: boolean;
  contributionType: string;
  reason: string;
  score: number; // 0-10, used only to rank/break ties — worthPosting is the real gate
}

const FALLBACK: Omit<JudgedReply, "reply"> = {
  worthPosting: false,
  contributionType: "none",
  reason: "judge call failed to parse — defaulting to reject",
  score: 0,
};

/**
 * Step 4: Judge whether a reply is actually worth posting.
 *
 * The bar isn't "is this educational" — it's "does this make the thread
 * better." A reply clears that bar if it does at least one of: adds a
 * useful insight, shares a relatable experience, makes a relevant joke,
 * challenges the premise respectfully, asks a thoughtful question,
 * provides missing context, or extends the discussion. Generic filler
 * ("I agree", "😂😂😂", "That's true") clears none of those and should
 * be rejected regardless of how "correct" it is.
 */
export async function judgeReplies(
  tweet: string,
  replies: string[]
): Promise<JudgedReply[]> {
  const results: JudgedReply[] = [];

  for (const reply of replies) {
    const response = await ollama.chat({
      model: "gpt-oss:20b",
      options: {
        temperature: 0.2, // Low temp for consistent judging
      },
      messages: [
        {
          role: "system",
          content: `
You are judging whether a reply to a tweet on X (Twitter) is worth posting.

The question isn't whether the reply is educational or grammatically
correct. It's: would a stranger scrolling this thread think this reply
was worth reading? Does it make the thread better?

A reply is worth posting if it does AT LEAST ONE of:
- adds a useful insight
- shares a relatable experience
- makes a relevant joke
- challenges the premise respectfully
- asks a thoughtful question
- provides missing context
- extends the discussion

Generic filler ("I agree", "That's true", "😂😂😂", or anything that just
restates the tweet) is NOT worth posting, even if it's on-topic and
grammatically fine.

Return JSON only:

{
  "worth_posting": true or false,
  "contribution_type": "insight" | "experience" | "joke" | "challenge" | "question" | "context" | "extension" | "none",
  "score": 0,
  "reason": "one sentence"
}

"score" is 0-10 and reflects overall quality — used only to rank replies
against each other, not as the pass/fail bar. Output ONLY the JSON.
`
        },
        {
          role: "user",
          content: `
Tweet: ${tweet}

Reply: ${reply}

Judge this reply.
`
        }
      ]
    });

    try {
      const parsed = JSON.parse(response.message.content.trim()) as {
        worth_posting?: boolean;
        contribution_type?: string;
        score?: number;
        reason?: string;
      };
      results.push({
        reply,
        worthPosting: parsed.worth_posting ?? false,
        contributionType: parsed.contribution_type ?? "none",
        score: parsed.score ?? 0,
        reason: parsed.reason ?? "",
      });
    } catch {
      results.push({ reply, ...FALLBACK });
    }
  }

  // Worth-posting replies first, then by score descending.
  results.sort((a, b) => {
    if (a.worthPosting !== b.worthPosting) return a.worthPosting ? -1 : 1;
    return b.score - a.score;
  });

  return results;
}
