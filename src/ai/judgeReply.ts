import ollama from "ollama";

export interface JudgedReply {
  reply: string;
  // Is this even a legitimate, human-postable reply at all — not an AI
  // provider error, a refusal, a stack trace, raw JSON/XML/HTML, a
  // markdown code block, an echoed-back prompt fragment, or anything else
  // that reads like internal output rather than something a person typed.
  // Checked BEFORE quality, since a well-written stack trace is still not
  // postable. errorDetection.ts's keyword list catches the known/obvious
  // cases for free without an inference call; this is the second,
  // more robust pass for the novel or subtly-worded ones a fixed phrase
  // list can't anticipate — "would a normal human intentionally post this
  // as a reply?" generalizes in a way regex never can.
  valid: boolean;
  worthPosting: boolean;
  contributionType: string;
  reason: string;
  score: number; // 0-10, used only to rank/break ties — worthPosting is the real gate
}

const FALLBACK: Omit<JudgedReply, "reply"> = {
  valid: false,
  worthPosting: false,
  contributionType: "none",
  reason: "judge call failed to parse — defaulting to reject",
  score: 0,
};

/**
 * Step 4: Validate and judge whether a reply is actually worth posting.
 *
 * Two questions, one pass: is this a real, postable reply at all, and (only
 * if so) does it make the thread better? The bar for the second question
 * isn't "is this educational" — it's: would a stranger scrolling this
 * thread think this reply was worth reading? A reply clears that bar if it
 * does at least one of: adds a useful insight, shares a relatable
 * experience, makes a relevant joke, challenges the premise respectfully,
 * asks a thoughtful question, provides missing context, or extends the
 * discussion. Generic filler ("I agree", "😂😂😂", "That's true") clears
 * none of those and should be rejected regardless of how "correct" it is.
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
You are validating AND judging a candidate reply to a tweet on X (Twitter), before it gets posted.

FIRST — validity. Would a real human intentionally post this exact text as their own reply? Reject as INVALID (regardless of how well-written it might otherwise read) if it is any of:
- An AI provider error message (rate limit, usage limit, authentication error, timeout, "connection interrupted", a Cloudflare/consent wall, etc.)
- A safety refusal ("I can't help with that", "I'm not able to...")
- A stack trace or other debugging/tool output
- Raw JSON, XML, or HTML
- A markdown code block
- A fragment of a prompt or system instructions accidentally echoed back
- Anything that reads like internal/system output rather than something a person would type as a casual reply

If any of those apply, set "valid": false, "worth_posting": false, "score": 0, and briefly say which one in "reason" — skip the quality judgment entirely.

SECOND — only if valid, judge quality. The question isn't whether the reply is educational or grammatically correct. It's: would a stranger scrolling this thread think this reply was worth reading? Does it make the thread better?

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
  "valid": true or false,
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

Validate and judge this reply.
`
        }
      ]
    });

    try {
      const parsed = JSON.parse(response.message.content.trim()) as {
        valid?: boolean;
        worth_posting?: boolean;
        contribution_type?: string;
        score?: number;
        reason?: string;
      };
      const valid = parsed.valid ?? true;
      results.push({
        reply,
        valid,
        // Never trust worth_posting over an invalid verdict, even if the
        // model's own JSON was inconsistent about it — invalid can never
        // be worth posting regardless of what else it said.
        worthPosting: valid && (parsed.worth_posting ?? false),
        contributionType: parsed.contribution_type ?? "none",
        score: valid ? (parsed.score ?? 0) : 0,
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
