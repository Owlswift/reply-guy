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
 * if so) does it read like something a real person would type? The bar for
 * the second question is deliberately NOT "does this add value" — requiring
 * every reply to teach something, land a joke, or extend the discussion is
 * exactly what makes an account read as AI rather than a person who's just
 * scrolling. A short, ordinary reaction with some specificity/personality
 * to it is a normal, worth-posting reply on its own. What still gets
 * rejected: content that's too polished/over-explained (reads like a
 * caption or a mini-essay), and zero-effort copy-paste filler with no
 * specificity to this tweet ("I agree", "😂😂😂") or that just restates the
 * tweet back.
 */
export async function judgeReplies(
  tweet: string,
  replies: string[],
  replyingTo?: string
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
${replyingTo ? `
This candidate is a reply to a SPECIFIC COMMENT in a thread, not to the original tweet directly. The original tweet is background context only. Your quality judgment must be based on whether the candidate directly engages with what the comment actually said — its specific point, question, or tone. A reply that is on-topic for the original tweet but ignores or talks past the comment is NOT worth posting, no matter how well-written.
` : ""}

FIRST — validity. Would a real human intentionally post this exact text as their own reply? Reject as INVALID (regardless of how well-written it might otherwise read) if it is any of:
- An AI provider error message (rate limit, usage limit, authentication error, timeout, "connection interrupted", a Cloudflare/consent wall, etc.)
- A safety refusal ("I can't help with that", "I'm not able to...")
- A stack trace or other debugging/tool output
- Raw JSON, XML, or HTML
- A markdown code block
- A fragment of a prompt or system instructions accidentally echoed back
- Anything that reads like internal/system output rather than something a person would type as a casual reply

If any of those apply, set "valid": false, "worth_posting": false, "score": 0, and briefly say which one in "reason" — skip the quality judgment entirely.

SECOND — only if valid, judge whether this reads like something a real person would actually type, not whether it's insightful. The question isn't "does this add value" — it's: would this look at home in a normal person's reply history, sitting next to their other casual replies? A short, ordinary reaction that teaches the reader nothing new is a completely normal, worth-posting reply. Most real replies on X are exactly that.

Reject as NOT worth posting if the candidate is:
- Too polished or over-explained — reads like a caption, a LinkedIn post, or has an obvious "analysis voice" structure (a tidy reframe, a built-to-be-quoted line, a mini-essay explaining the deeper meaning of a tweet that didn't need one).
- Zero-effort copy-paste filler with no specificity to ${replyingTo ? "the comment" : "the tweet"} — a bare "I agree" / "this is so relatable" / "😂😂😂" that could sit under literally any tweet, or a reply that just restates ${replyingTo ? "the comment" : "the tweet"} back in different words.

Otherwise it's worth posting — including a short reaction, a one-line joke, a casual opinion, or simple agreement WITH some personality or specificity to it (as opposed to the generic zero-effort version above). Don't require insight, a lesson, a challenge, or an extension of the discussion — demanding that on every reply is exactly what makes an account read as an AI account instead of a person who's just scrolling.

Return JSON only:

{
  "valid": true or false,
  "worth_posting": true or false,
  "contribution_type": "reaction" | "joke" | "opinion" | "agreement" | "question" | "experience" | "insight" | "none",
  "score": 0,
  "reason": "one sentence"
}

"score" is 0-10 and reflects how natural/human this reads (not how much it
teaches) — used only to rank replies against each other, not as the
pass/fail bar. Output ONLY the JSON.
`
        },
        {
          role: "user",
          content: `
${replyingTo ? `Original tweet (background only): ${tweet}\n\nComment being replied to (judge against this): ${replyingTo}` : `Tweet: ${tweet}`}

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
