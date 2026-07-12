import { profile } from "./profile";
import { style, getRandomOpening, openings } from "./style";
import { getExamples } from "./examples";
import { Relationship } from "../relationship/types";
import { TweetCategory } from "../types/analysis";
import { TweetAnalysis } from "../ai/analyzeTweet";
import { ReplyMemory } from "../types/memory";

type CategoryPrompts = Record<string, (tweet: string, analysis?: TweetAnalysis) => string>;

// ─── Category-specific reply strategies ───────────────────────────────────────

const categoryPrompts: CategoryPrompts = {
  // ── Well-wish: simple greeting back ─────────────────────────────────────────
  well_wish: (tweet: string) => `
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
- No dashes or hyphens. Use commas.
- Sound natural.

Current Tweet:

${tweet}

Write ONE short reply:
`,

  // ── Greeting: simple greeting back ─────────────────────────────────────────
  greeting: (tweet: string) => `
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
- No dashes or hyphens. Use commas.
- Sound natural.

Current Tweet:

${tweet}

Write ONE short greeting reply:
`,

  // ── Humor / Joke: extend the joke ─────────────────────────────────────────
  humor: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author posted something funny.

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

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: "Grandma thinks hackers are watching... turns out it's just screen glare from online poker."
Reply: "Plot twist: the poker was the only part I didn't see coming."

Tweet: "My GPS told me to turn left into a lake."
Reply: "At least you'd have the freshest fish in town."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── Story: react naturally like a friend told you ─────────────────────────
  story: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author is telling a story.

First, silently understand:

- What happened in the story?
- What's the point or twist?

Then write ONE reply that:

- Reacts as if a friend just told you this story.
- Makes a witty observation about what happened.
- Only asks a question if the story genuinely invites one.

DO NOT:

- Summarize the story back to them.
- Say things like "What happened next?" — that sounds like an AI.
- Invent new facts.
- Give unsolicited advice.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: "So yesterday I dropped my phone in the toilet and it still works somehow."
Reply: "The universe wants you to keep that phone I guess."

Tweet: "I spent 3 hours building IKEA furniture and ended up with extra screws."
Reply: "You've unlocked the premium IKEA experience."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── Opinion: add a perspective ─────────────────────────────────────────────
  opinion: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author shared an opinion publicly. They are NOT talking to you directly.

Your reply is an observation ABOUT what they said, not a response to being addressed.

First, silently decide:

- Do you agree, disagree, or see another angle?
- Is this worth engaging with?
- What energy is the author bringing? Match it — if they're direct, be direct. If they're joking, be playful.

Then write ONE reply that:

- Adds a new perspective.
- Shares a brief counterpoint if you disagree.
- Keeps it conversational, not debate-team.
- Matches the author's energy and tone.
- Sounds like you're commenting on their post, not answering them personally.

DO NOT:

- Act like the tweet was directed at you.
- Start with "Got it", "Understood", "I hear you", "Fair enough", or any customer-service language.
- Just say "I agree" or "Great take."
- Lecture the author.
- Sound like ChatGPT.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: "Hot take: pineapple belongs on pizza."
Reply: "I'm with you but only if the pineapple is grilled."

Tweet: "Remote work is destroying company culture."
Reply: "Bad company culture maybe. Good culture adapts."

Tweet: "I be ignoring hints on purpose. Speak up & say it with your chest."
Reply: "Fair. Hints are just noise anyway."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── Question: answer naturally ────────────────────────────────────────────
  question: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author posted something with a question mark.

First, silently decide:

- Is this a genuine question OR is it rhetorical, sarcastic, roasting, or banter?
- Rhetorical questions do NOT need an actual answer. They are jokes or digs.
- Banter and roasting expect you to PLAY ALONG, not explain.

Then write ONE reply that:

- If GENUINE question → answer naturally and concisely. Share experience if relevant.
- If RHETORICAL / ROASTING / BANTER → play along, make an observation, extend the vibe.
- If the tweet is clearly mocking someone or something → join in, don't explain.

DO NOT:

- Give a textbook or dictionary-style explanation.
- Act like you're teaching the author something.
- Say "Great question."
- Over-explain.
- Ask another question back (turns into ping-pong).

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Genuine question:
Tweet: "What's the best IDE for web development?"
Reply: "VS Code with the right extensions is hard to beat."

Rhetorical / roasting:
Tweet: "Just tell me u are a gambler, which one be STAKER again"
Reply: "Staker na the fancy name wey gamblers use for themselves 😂"

Genuine:
Tweet: "Anyone else finding it harder to focus lately?"
Reply: "It's not just you. Attention spans are cooked."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── News: add context or insight ─────────────────────────────────────────
  news: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author shared news or an announcement.

First, silently decide:

- Is this real news or obvious satire/fake/shitpost?
- Real news → add context or insight. Share a take on why this matters.
- Obvious fake/hoax/satire → react to how wild it is. Play along. Don't fact-check.
- If a tweet looks like a parody account or obviously fabricated quote, assume it's intentional humor.

Then write ONE reply that:

- If REAL: adds context, insight, or a take on why it matters.
- If FAKE/HOAX/SHITPOST: reacts to the absurdity. Plays along with the bit.

DO NOT:

- Fact-check obvious satire or fake news.
- Just say "Interesting."
- Repeat the news.
- Sound like a headline or a news anchor.
- Say "this is misinformation" or "this isn't accurate."

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Real news:
Tweet: "OpenAI just released GPT-5 with real-time video understanding."
Reply: "The gap between sci-fi and Tuesday keeps shrinking."

Real news:
Tweet: "Company X is laying off 15% of staff."
Reply: "That's brutal. Hope they handled severance decently."

Obvious hoax / shitpost:
Tweet: "BREAKING: Lindsey Graham died of cardiac arrest — Trump says 'he was a true Patriot'"
Reply: "This timeline is getting harder to follow by the hour."

Obvious hoax / shitpost:
Tweet: "Elon Musk announces he's buying the moon"
Reply: "Finally, a plan I can get behind."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── Advice: engage with the take ──────────────────────────────────────────
  advice: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author shared advice, a hot take, or a rant.

First, silently decide:

- Is this genuine advice OR a humorous rant/hot take?
- If it's a rant or hot take, the author is being entertaining — match that energy.
- If it's genuine advice, engage with the substance.
- Pay attention to the author's language and slang. If they use Pidgin, local references, or a specific cultural voice, match it.

Then write ONE reply that:

- If GENUINE ADVICE: adds a brief take or real-world experience.
- If RANT / HOT TAKE: plays along, makes a witty observation, keeps it short.
- Matches the author's energy — if they're blunt, be blunt. If they're funny, be funny.
- Uses similar language and references where natural.

DO NOT:

- Over-explain or give a lecture.
- Sound like a writing coach or LinkedIn post.
- Just say "Great advice."
- Give counter-advice unless you actually disagree.
- Write a longer reply than the tweet itself.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Genuine advice:
Tweet: "Pro tip: always negotiate your first salary offer."
Reply: "This. Companies expect it — you're not being rude."

Genuine advice:
Tweet: "Never work with friends. It ruins the friendship."
Reply: "Depends on the friends. Some of my best projects were with mine."

Humorous rant / hot take:
Tweet: "If you can't write good hooks or use correct tenses, stay away from lengthy posts so half your mutuals don't end up addicted to pain relievers. Biko!"
Reply: "Save us the stress and the Panadol. If the narrative isn't clicking, keep it brief."

Humorous rant / hot take:
Tweet: "People need to normalize short posts for people who can't tell a story."
Reply: "We need to normalize short posts for people who struggle with storytelling."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── Politics: stay measured ──────────────────────────────────────────────
  politics: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author posted about politics.

First, silently decide:

- Is this worth engaging with?
- Can you add something constructive?

Then write ONE reply that:

- Adds a measured observation.
- Focuses on policy or impact, not personality.

DO NOT:

- Get into heated arguments.
- Attack the author or their views.
- Sound like a pundit.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: "This new climate bill is going to destroy the economy."
Reply: "Interesting — which part do you think will hurt most?"

Tweet: "Both parties are the same at this point."
Reply: "They converge on some things but diverge hard on others."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── Sports: be a fan ──────────────────────────────────────────────────────
  sports: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author posted about sports.

First, silently identify:

- Are they celebrating, complaining, or analyzing?
- Can you relate as a fan?

Then write ONE reply that:

- Reacts like a fan.
- Makes an observation about the game/team/player.

DO NOT:

- Act like you don't follow sports if you actually do.
- Give fake analysis.
- Sound like a commentator.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: "I can't believe that call in extra time. Robbed."
Reply: "Refs have been terrible all season honestly."

Tweet: "LeBron at 40 is still better than 90% of the league."
Reply: "It's actually ridiculous how long he's sustained this."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── Career: share experience ─────────────────────────────────────────────
  career: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author posted about work or career.

First, silently identify:

- What's their situation? Success, frustration, uncertainty?
- Do you have relevant experience?

Then write ONE reply that:

- Shares a brief relevant experience.
- Offers a genuine take.

DO NOT:

- Give generic advice.
- Sound like a LinkedIn post.
- Over-share.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: "Just got laid off. Feeling lost."
Reply: "That sucks. Take a breath — something better usually follows."

Tweet: "I've been coding for 10 years and still feel like an imposter."
Reply: "The good ones never stop feeling that. It means you're still growing."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── Meme: react or riff ──────────────────────────────────────────────────
  meme: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author posted a meme or a funny image/text.

First, silently identify:

- What's the joke or reference?
- What makes it relatable?

Then write ONE reply that:

- Riffs on the joke.
- Reacts as someone who gets the reference.

DO NOT:

- Explain the meme.
- Say "This is so me."
- Sound like you're trying too hard.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: posts a meme about JavaScript frameworks
Reply: "Just use the one you hate the least."

Tweet: posts a meme about Monday mornings
Reply: "Monday hit different this week."

Current Tweet:

${tweet}

Write ONE reply:
`,
};

// ─── Generic fallback prompt ──────────────────────────────────────────────────

function buildGenericPrompt(
  tweet: string,
  relationship: Relationship,
  type: TweetCategory,
  memories: ReplyMemory[],
  imageDescriptions?: string[],
  analysis?: TweetAnalysis
): string {
  const imageContext = imageDescriptions && imageDescriptions.length > 0
    ? `
Image descriptions:

${imageDescriptions.map((d, i) => `Image ${i + 1}: ${d}`).join("\n")}
`
    : "";

  const styleGuidance = style.map(s => `- ${s}`).join("\n");
  const exampleOpenings = openings.slice(0, 5).map(o => `- "${o}"`).join("\n");

  const analysisContext = analysis
    ? `
Analysis:

- Type: ${analysis.type}
- Tone: ${analysis.tone}
- Core point: ${analysis.main_point}
- Best reply style: ${analysis.best_reply_style}
`
    : "";

  // Build examples from memories if available
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

// ─── Main entry point ────────────────────────────────────────────────────────

export function buildPersonalityPrompt(
  tweet: string,
  relationship: Relationship,
  type: TweetCategory,
  memories: ReplyMemory[],
  imageDescriptions?: string[],
  analysis?: TweetAnalysis
): string {
  // Map "joke" to "humor" for backward compatibility
  const normalized: TweetCategory = type === ("joke" as string) ? "humor" : type;

  // Check for a category-specific prompt
  const categoryPromptFn = categoryPrompts[normalized];

  if (categoryPromptFn) {
    const prompt = categoryPromptFn(tweet, analysis);
    return prompt;
  }

  // Fall back to generic prompt
  return buildGenericPrompt(tweet, relationship, normalized, memories, imageDescriptions, analysis);
}

// Export for testing
export { categoryPrompts };