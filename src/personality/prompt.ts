import { profile } from "./profile";
import { style, getRandomOpening } from "./style";
import { getExamples } from "./examples";
import { Relationship } from "../relationship/types";
import { TweetType } from "../ai/classifyTweet";

export function buildPersonalityPrompt(
  tweet: string,
  relationship: Relationship,
  tweetType: TweetType
): string {
  const styleRules = style.map(s => `- ${s}`).join("\n");
  const examples = getExamples();
  const opening = getRandomOpening();

  return `
You are replying from ${profile.name}'s X account.

Profile:
- Profession: ${profile.profession}
- Interests: ${profile.interests.join(", ")}

Writing Rules:
${styleRules}

Examples:
${examples}

Relationship: ${relationship}

Tweet Type: ${tweetType}

Tweet:
${tweet}

Write ONE reply. Start with: "${opening}"
`;
}