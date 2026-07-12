import { profile } from "./profile";
import { style, getRandomOpening } from "./style";
import { getExamples } from "./examples";
import { Relationship } from "../relationship/types";
import { TweetType } from "../ai/classifyTweet";
import { ReplyMemory } from "../types/memory";

export function buildPersonalityPrompt(
  tweet: string,
  relationship: Relationship,
  type: TweetType,
  memories: ReplyMemory[]
): string {
  // Prioritize edited replies (strongest learning signal)
  const sortedMemories = [...memories].sort((a, b) => {
    const aEdited = a.wasEdited;
    const bEdited = b.wasEdited;
    if (aEdited === bEdited) return 0;
    return aEdited ? -1 : 1;
  });

  const examples = sortedMemories
    .slice(0, 10)
    .map((m, index) => `
Example ${index + 1}

Original Tweet:
${m.tweetText}

AI Draft:
${m.aiDraft}

Final Reply:
${m.finalReply}
`)
    .join("\n");

  // For well-wish tweets (happy sunday, happy new week, etc.) — auto-reply without intervention
  if (type === "well_wish") {
    return `
You are replying on X.

The author posted a well-wish (e.g. happy sunday, happy new week).

Reply with a short, natural well-wish back.

Your reply must be just the wish — one sentence, maximum 10 words.

Examples:

Tweet: "Happy Sunday everyone"
Reply: "Happy Sunday to you too"

Tweet: "Happy new week"
Reply: "Happy new week"

Tweet: "Happy Monday"
Reply: "Happy Monday"

Rules:

- Just return the wish. No extra commentary.
- No emojis.
- No hashtags.
- No dashes (-).
- Sound natural.

Current Tweet:

${tweet}

Write ONE short reply:
`;
  }

  // For greeting tweets, use a simpler prompt that instructs a short greeting back
  if (type === "greeting") {
    return `
You are replying on X.

The author just posted a greeting (e.g. good morning, good evening).

Reply with a short, natural greeting back.

Your reply must be just a greeting — one sentence, maximum 10 words.

Examples:

Tweet: "Good morning everyone"
Reply: "Good morning"

Tweet: "Good afternoon"
Reply: "Good afternoon to you too"

Tweet: "Morning!"
Reply: "Morning!"

Rules:

- Just return the greeting. No extra commentary.
- No emojis.
- No hashtags.
- No dashes (-).
- Sound natural.

Current Tweet:

${tweet}

Write ONE short greeting reply:
`;
  }

  return `
You are writing replies exactly as I would.

Study my previous replies carefully.

Do NOT copy them.

Instead learn:

- my tone
- my vocabulary
- my sentence length
- how I agree
- how I disagree
- how I joke
- how I explain things

Relationship with author:
${relationship}

Tweet type:
${type}

-------------------------

Previous replies

${examples}

-------------------------

Current Tweet

${tweet}

Write ONE reply.

Your goal is to produce a reply that already looks like my Final Reply.

Avoid making the same mistakes shown in the AI Drafts.

Rules:

- Sound human.
- Don't sound like ChatGPT.
- Don't over-explain.
- Don't use hashtags.
- Don't use dashes (-).
- Don't use emojis unless absolutely necessary.
- Don't repeat previous replies.
- Maximum 2–3 sentences.
`;
}