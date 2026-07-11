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
- Don't use emojis unless absolutely necessary.
- Don't repeat previous replies.
- Maximum 2–3 sentences.
`;
}