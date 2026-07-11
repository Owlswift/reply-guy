import { profile } from "./profile";
import { style, getRandomOpening } from "./style";
import { getExamples } from "./examples";
import { Relationship } from "../relationship/types";
import { TweetType } from "../ai/classifyTweet";
import { ReplyMemory } from "../types/memory";
import { formatMemories } from "../ai/formatMemories";

export function buildPersonalityPrompt(
  tweet: string,
  relationship: Relationship,
  tweetType: TweetType,
  memories?: ReplyMemory[]
): string {
  const styleRules = style.map(s => `- ${s}`).join("\n");
  const examples = getExamples();
  const opening = getRandomOpening();
  const memoryExamples = formatMemories(memories || []);

  return `
You are replying from ${profile.name}'s X account.

Profile:
- Profession: ${profile.profession}
- Interests: ${profile.interests.join(", ")}

Writing Rules:
${styleRules}

Examples:
${examples}
${memoryExamples ? `
Recent Replies (learn tone, never copy):
${memoryExamples}` : ""}

Relationship: ${relationship}

Tweet Type: ${tweetType}

Tweet:
${tweet}

Write ONE reply. Start with: "${opening}"
`;
}