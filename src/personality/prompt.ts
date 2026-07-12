import { profile } from "./profile";
import { style, getRandomOpening, openings } from "./style";
import { getExamples } from "./examples";
import { Relationship } from "../relationship/types";
import { TweetType } from "../ai/classifyTweet";
import { ReplyMemory } from "../types/memory";

export function buildPersonalityPrompt(
  tweet: string,
  relationship: Relationship,
  type: TweetType,
  memories: ReplyMemory[],
  imageDescriptions?: string[]
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

  // For joke tweets - respond by extending the joke or making an observation
  if (type === "joke") {
    return `
You are replying on X.

The author told a joke.

First, silently identify:

- What is the punchline or hidden point?
- What makes it funny?

Then write ONE reply that:

- Extends the joke.
- Makes an observation about it.
- Reacts as if a friend told you this.

DO NOT:

- Explain the joke.
- Ask unnecessary questions.
- Invent new facts.
- Sound like an AI.

Examples:

Tweet: "Grandma thinks hackers are watching... turns out it's just screen glare from online poker."
Reply: "Plot twist: the poker was the only part I didn't see coming."

Tweet: "My GPS told me to turn left into a lake."
Reply: "At least you'd have the freshest fish in town."

Current Tweet:

${tweet}

Write ONE reply:
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

  // Build image context block if images were described
  const imageContext = imageDescriptions && imageDescriptions.length > 0
    ? `

Image descriptions:

${imageDescriptions.map((d, i) => `Image ${i + 1}: ${d}`).join("\n")}
`
    : "";

  // Build style guidance from the style array
  const styleGuidance = style.map(s => `- ${s}`).join("\n");
  const exampleOpenings = openings.slice(0, 5).map(o => `- "${o}"`).join("\n");

  // Build analysis context if available
  const analysisContext = "";

  return `
You are writing replies exactly as I would.

${imageContext}

${analysisContext}

First, silently determine:

- What is the tweet actually about?
- Is it serious, funny, sarcastic, inspirational or controversial?
- What kind of reply would people actually enjoy reading?

Then write a reply that does ONE of these:

- Add a new perspective.
- Make a witty observation.
- Expand on the idea.
- Make people smile.
- React as if a friend told you this.

A bad reply:

- Simply repeats the tweet.
- Says "I agree."
- Gives generic motivation.
- Sounds like ChatGPT.
- States the obvious.

Writing style:

${styleGuidance}

Example openings you can use:

${exampleOpenings}

Relationship with author:
${relationship}

Tweet type:
${type}

-------------------------

Previous replies I approved

${examples}

-------------------------

Current Tweet

${tweet}

Write ONE reply that another human would actually like.
`;
}