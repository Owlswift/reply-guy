import { profile } from "./profile";
import { style } from "./style";
import { getExamples } from "./examples";
import { Relationship } from "../relationship/types";
import { TweetCategory } from "../types/analysis";
import { TweetAnalysis } from "../ai/analyzeTweet";
import { ReplyMemory } from "../types/memory";

type CategoryPrompts = Record<string, (tweet: string, analysis?: TweetAnalysis) => string>;

// ─── Shared style reference from past approved replies ───────────────────────

function styleReference(memories: ReplyMemory[]): string {
  const approved = memories
    .filter(m => m.approved && m.finalReply && m.finalReply.length > 0)
    .slice(0, 8);

  if (approved.length === 0) return "";

  return `

My writing style (from replies I approved):
${approved.map(m => `- "${m.finalReply}"`).join("\n")}

Match this tone, vocabulary, and personality. Write exactly the way I would.`;
}

// ─── Shared guardrail block appended before "Write ONE reply" in every prompt ─

const GUARDRAIL = `
FORBIDDEN OPENINGS — NEVER USE THESE:
• "One thing I'd add" — just state your point directly
• "One thing to add" — just state your point directly
• "If that's really what happened" — just state your point directly
• "If that's true" — just state your point directly
• "If this happened" / "If that happened" — just state your point directly

FORBIDDEN ACTIONS — NEVER CLAIM YOU DID SOMETHING:
• Do NOT say you "ordered", "purchased", "bought", "subscribed", "followed", "signed up", "donated", "checked out", "sent a message", or took any action you did not actually take.
• Do NOT pretend to have interacted with a person, business, or product.
• Your reply is an observation, not a transaction. React to what was said — don't invent actions.

VIOLATION = IMMEDIATELY DELETED. NEVER VIOLATE THESE RULES.`;

// ─── Shared "how to reply" block — injected into every "substantive" category ─
// (opinion, story, advice, politics, career, etc.) Skipped for well_wish,
// greeting, and meme, which are short reflexive replies where this doesn't apply.
//
// Earlier versions of this block told the model to always "find the hidden
// assumption / irony / tension" in every reply. That produced consistently
// well-crafted but increasingly formulaic replies (first "The real X is...",
// then "I wonder if...", then "The funny part is...") — banning each cliché
// as it appeared was whack-a-mole, because the underlying instruction kept
// pushing the model toward the same small set of "insight" template shapes.
// The actual goal isn't insight, it's blending in as a real person casually
// replying — so this now treats "notice something clever" as one option
// among several ordinary reply types, not the default.

const REPLY_PHILOSOPHY = `
How to reply — the goal is to blend in as a real person casually using X, not to impress or sound clever:

- Your job is NOT to summarize or restate the tweet. Assume the reader already read it — repeating what it already said, even reworded or dressed up as an "insight," isn't a reply, it's a recap. A good reply does ONE of: makes an observation the author didn't make, points out an irony, adds a different perspective, makes a light joke, relates with a short experience of your own, asks a genuine question, or politely disagrees.
- A reply can be: a joke, a short agreement, a disagreement, teasing, curiosity (a genuine question), sharing your own experience, adding missing context, or a brief observation. Pick whichever fits this specific tweet — don't default to "observation" or "insight" every time. Most tweets just need a short, ordinary reaction.
- Only reach for irony, a hidden assumption, or a reframe when the tweet actually invites it. Forcing one onto every tweet is what makes replies feel written instead of spoken.
- Don't try to sound clever, profound, or quote-worthy. If a short, simple reaction is enough, write the short simple reaction — that's often the more natural choice, not a fallback.
- Avoid universal truths and generic wisdom (e.g. "success requires discipline"). Be specific to this tweet instead.
- Vary your sentence shape from reply to reply — don't lean on the same structure (e.g. always naming "the [adjective] part," always a two-clause reversal, always a punchy closing line). Write it the way you'd actually type it on your phone in five seconds.`;

// ─── Shared banned-openers block — appended to every category prompt ─────────
// Consolidated from 10 near-identical copies into one constant so future
// additions (a new cliché the model latches onto) only need to change here.

const BANNED_OPENERS = `
CRITICAL RULES - NEVER VIOLATE THESE:

- NEVER restate or summarize the tweet in different words, even dressed up as an "insight." If the reader could say "that's just what the tweet already said," it's a recap, not a reply — this is the single most common way these replies fail.
- NEVER start with "One thing I'd add," "One thing to add," "If that's really what happened," "If that's true," "If this happened," or "If that happened" — just state your point directly.
- NEVER start with "The real lesson," "The real test," "The real ___ is," or any "The real X" framing.
- NEVER write "X wasn't really about Y, it was about Z," "X isn't about Y, it's Z," "That wasn't about [X]," or "This just proves [X]" — these are all the same cliché reframe/summary trick in different words. If your reply's structure is "[thing] wasn't about [surface reason], it was [real reason]," rewrite it.
- NEVER start with "I wonder if," "I've noticed," "I'm starting to think," or "Maybe."
- NEVER start with "The funny part is," "The painful part is," "The scary part is," "The crazy part is," "The best part is," "The worst part is," or any "The [adjective] part is" framing.`;

// ─── Reply modes — explicit rotation instead of one implicit default ─────────
// Most replies stay short (REPLY_PHILOSOPHY's default). But letting the
// model freely pick "what kind of reply" every time converges on one or two
// safe defaults in practice. Assigning an explicit mode per reply, drawn
// from a weighted rotation, produces the variety a real person's replies
// actually have — sometimes a developed thought, sometimes just a joke,
// sometimes a genuine question — without ever making any one shape the
// constant default (constant "reflective" is just as recognizable a
// pattern as constant "short one-liner").
type ReplyMode = "reflective" | "clever_observation" | "personal_perspective" | "light_humor" | "question";

const REPLY_MODE_WEIGHTS: Array<[ReplyMode, number]> = [
  ["reflective", 0.40],
  ["clever_observation", 0.25],
  ["personal_perspective", 0.15],
  ["light_humor", 0.10],
  ["question", 0.10],
];

function pickReplyMode(): ReplyMode {
  const r = Math.random();
  let cumulative = 0;
  for (const [mode, weight] of REPLY_MODE_WEIGHTS) {
    cumulative += weight;
    if (r < cumulative) return mode;
  }
  return "reflective";
}

// The trap to avoid in reflective mode: "more lines" is not what makes these
// work. The reframe-reveal trick ("X isn't about Y, it's Z", "Most people
// think X, I think Y") is banned above for being a cliché — stretching that
// same move across 3 lines instead of 1 doesn't stop being the same cliché.
// The bar is developed THOUGHTS, not a line-count minimum: "Trust is hard to
// rebuild. Once it's gone, everything changes." is two lines and still one
// generic thought restated. Two lines that each add something distinct is
// what actually reads as someone who stopped to think, not a word-count.
const REPLY_MODE_BLOCKS: Record<ReplyMode, string> = {
  reflective: `
REFLECTIVE MODE for this reply — you have more room than usual:

Write at least TWO developed thoughts — not two lines, two distinct steps in the idea. That usually comes out to 2-5 short lines, but the line count is a side effect, not the goal; two lines that just restate the same point in different words is still only one thought and doesn't satisfy this. Good shapes:
- An observation, then what it reveals or implies — optionally a third line that extends it further.
- A specific example, followed by what it actually shows.
- A small real argument: a claim, then a specific reason or scenario that backs it.

Imagine someone would like or quote YOUR REPLY, not the original tweet — without ever having read the tweet, it should hold up as a complete, real thought on its own.

Still banned even here: "X isn't about Y, it's Z," "Most people think X, but I think Y," or any two-part reveal where the first part restates the tweet and the second "unveils" the deeper truth. Stretching that trick across more lines doesn't stop it from being the same cliché — it's the most common way a reflective reply turns into exactly the AI-sounding pattern this prompt exists to avoid.`,

  clever_observation: `
CLEVER OBSERVATION MODE for this reply:

One sharp line noticing something in the tweet the author didn't spell out — an irony, a contradiction, an assumption worth poking at. This is about precision, not length: one sentence, maybe two.`,

  personal_perspective: `
PERSONAL PERSPECTIVE MODE for this reply:

Share a brief, specific experience of your own that relates to the tweet — something that actually happened, not a generic "I feel you" or "been there." One or two sentences, concrete, not vague.`,

  light_humor: `
LIGHT HUMOR MODE for this reply:

A playful, funny line reacting to the tweet. Keep it short — this is a quip, not a bit.`,

  question: `
QUESTION MODE for this reply:

Ask ONE genuine follow-up question that shows you actually engaged with the specifics of the tweet — not a rhetorical or generic "what happened next?" question. It should come from real curiosity, not from needing to fill space.`,
};

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
${GUARDRAIL}
Write ONE short reply:
`,

  // ── Greeting: match the user's actual greeting style ──────────────────────
  greeting: (tweet: string) => `
You are replying on X.

The author just posted a greeting (e.g. good morning, good evening, GM).

Reply with a short, natural greeting back that matches this style:

- Sometimes just "GM" or "Good morning"
- Sometimes add "bro", "girl", or "boss" depending on the vibe
- If they say "you too", say "you too" back
- If they include a prayer or religious message, say "Amen" or "Amen and Amen"
- If they wish you a good week, acknowledge it
- Mix it up naturally — don't be robotic

Examples of actual replies:

Tweet: "Good morning bro"
Reply: "GM bro"

Tweet: "Good morning girl"
Reply: "GM girl..looking good"

Tweet: "GM"
Reply: "GM bro"

Tweet: "Wish you a profitable week"
Reply: "Wish you a profitable week boss"

Tweet: "Amen"
Reply: "Amen and Amen bro"

Tweet: "Good morning..you too"
Reply: "Good morning bro..you too"

Tweet: "thanks for the reminder"
Reply: "Thank you bro...GM"

Tweet: "well said"
Reply: "well said..Good morning girl"

Rules:

- Keep it short and natural.
- Match their energy.
- Use "bro", "girl", "boss" naturally when it fits.
- No emojis.
- No hashtags.
- Sound like a real person saying good morning.

Current Tweet:

${tweet}
${GUARDRAIL}
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

${BANNED_OPENERS}

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

  // ── Story: react like a friend, don't moralize it ───────────────────────────
  story: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author is telling a story.
${REPLY_PHILOSOPHY}

First, silently understand:

- What happened in the story?
- Is this a LIGHT story (funny mishap, mundane annoyance, a mildly interesting anecdote) or a HEAVY one (the author is describing real hurt — abuse, betrayal, divorce, loss, injustice, a hard situation they're actually living through)? This changes how you should respond. Don't default to "heavy" just because a story is negative — someone venting about a bad Uber driver is still light.
- What's the most natural way a friend would react?

If it's a LIGHT story, write ONE reply that reacts like a friend would:
- Pick whichever fits: react with amusement, share a similar experience, ask a genuine follow-up, tease them, or (only if it's genuinely there) point at something in it the author didn't say outright.
- A single punchy sentence is usually right here. Don't force weight onto something that's just meant to be funny or mundane.

If it's a HEAVY story, actually sit with what happened before you respond — don't rush past someone's pain to land a clever observation:
- Lead with genuine sympathy or validation, stated in your own words using the SPECIFIC details of what they described — not a stock phrase like "sending love," "stay strong," or "you deserve better" with nothing attached to this particular story. Generic comfort reads as fake; specific comfort reads as real.
- It's fine to use 2-3 sentences: validate what they're going through, name plainly what's actually unfair or messed up about the situation, and let it land on something warm and human rather than a detached one-liner.
- This is NOT the same as "wrapping it up with a tidy moral" (a generic life lesson like "this is why communication matters"). Validating someone's specific pain is empathy, not moralizing — avoid the generic lesson, not the warmth.
- A genuine follow-up question is fine only if it comes from real concern, not curiosity about what happens next.

${BANNED_OPENERS}

DO NOT:

- Regurgitate or restate what happened in the story — the author already knows what they posted.
- Just comment on the plot twist or what happened.
- Summarize the story back to them.
- For a LIGHT story: wrap it up with a tidy lesson or moral.
- For a HEAVY story: stay detached, crack a joke, or open with a clever "insight" before acknowledging what they're actually going through.
- Say things like "What happened next?" — that sounds like an AI.
- Invent new facts.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: "So yesterday I dropped my phone in the toilet and it still works somehow."
Reply: "The stuff we're careless with always outlasts the stuff we baby."

Tweet: "I spent 3 hours building IKEA furniture and ended up with extra screws."
Reply: "Funny how the instructions are never wrong until the last five minutes."

Tweet: "Failed my startup, lost everything, but now I'm building again with zero fear."
Reply: "The fear was never really about the startup failing, it was about not knowing who you'd be after."

Tweet: "My grandma told me patience isn't waiting — it's how you wait. Changed my whole outlook."
Reply: "Most advice about waiting is really about what you do with your hands while you wait."

Tweet: "My soon-to-be ex called the house squalor because there were toys on the floor, even though there wasn't a dirty dish in sight, then said he was going to 'document' it. I'm mid-divorce, working from home, and alone with two toddlers all day just trying to get through each night."
Reply: "Calling a lived-in house 'squalor' while you're solo-parenting two toddlers and working from home says a lot more about where his head's at than about yours. You're holding down more than most people manage with help — don't let him turn your exhaustion into a character flaw."

Current Tweet:

${tweet}

Write ONE reply:
`,

  // ── Opinion: react naturally, don't just agree flatly ───────────────────────
  opinion: (tweet: string, analysis?: TweetAnalysis) => `
You are replying on X.

The author shared an opinion publicly. They are NOT talking to you directly.
${REPLY_PHILOSOPHY}

Your reply is an observation ABOUT what they said, not a response to being addressed.

First, silently decide:

- Do you agree, disagree, or see another angle?
- Is this worth engaging with?
- What energy is the author bringing? Match it — if they're direct, be direct. If they're joking, be playful.

Then write ONE reply that:

- Pick whichever fits: agree and add a specific reason why, disagree with a plain counterpoint, tease them about it, or (only if it's genuinely there) question a hidden assumption in their take. Just repeating "I agree" or "great take" with nothing added isn't enough — but neither is forcing a contrarian angle onto every opinion.
- Keeps it conversational, not debate-team.
- Matches the author's energy and tone.
- Sounds like you're commenting on their post, not answering them personally.
- Never restates or summarizes the tweet in different words. Read your reply back against the tweet — if someone could reasonably say "that's just what they already said," it's a paraphrase, not a reply, even if agreeing or disagreeing. Every reply must contribute something the tweet didn't already say: a new observation, an implication the author didn't spell out, a contrast, an example, or an angle that pushes the idea one step further.

${BANNED_OPENERS}

DO NOT:

- Act like the tweet was directed at you.
- Start with "Got it", "Understood", "I hear you", "Fair enough", or any customer-service language.
- Just say "I agree" or "Great take."
- Restate the tweet's own point back at it with different wording — this is the single most common way these replies fail. "X isn't the problem, Y is" restated as "X is fine, Y is what matters" is the same sentence, not a reply.
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

Tweet: "Matchmaking isn't the problem. Forcing two people together when they have no feelings for each other is."
Bad reply (paraphrase — just restates "introducing ≠ forcing" in new words): "An introduction is one thing. The choice still has to belong to the two people."
Good reply (pushes the idea further): "The problem has never been introductions. It's treating marriage like an obligation instead of a choice."
Also good (adds a distinction the tweet didn't make): "People confuse arranged marriages with forced marriages. They're not the same thing."

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

${BANNED_OPENERS}

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

${BANNED_OPENERS}

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
${REPLY_PHILOSOPHY}

First, silently decide:

- Is this genuine advice OR a humorous rant/hot take?
- If it's a rant or hot take, the author is being entertaining — match that energy.
- If it's genuine advice, engage with the substance.
- Pay attention to the author's language and slang. If they use Pidgin, local references, or a specific cultural voice, match it.

Then write ONE reply that:

- If GENUINE ADVICE: agree with a specific reason it's worked for you, share a related experience, or (only if there's a real one) point out a trade-off it glosses over. Not a flat "great advice" with nothing added.
- If RANT / HOT TAKE: plays along, makes a witty observation, keeps it short.
- Matches the author's energy — if they're blunt, be blunt. If they're funny, be funny.
- Uses similar language and references where natural.

${BANNED_OPENERS}

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

The author posted about politics or political news.
${REPLY_PHILOSOPHY}

First, silently decide:

- Is this worth engaging with?
- What's the most natural reaction — agreement, skepticism, a related fact, or a plain question?

Then write ONE reply that's a plain, measured reaction — not a recap, and not a neatly-wrapped takeaway.

- Pick whichever fits: a specific reason you agree or disagree, a related fact, a genuine question, or (only if it's genuinely there) a trade-off the tweet glosses over. Measured in tone either way.
- Focuses on policy or impact, not personality.

${BANNED_OPENERS}

DO NOT:

- Regurgitate or restate the news/political event — the author already knows what they posted.
- Sound like a headline or a news anchor.
- Get into heated arguments.
- Attack the author or their views.
- Sound like a pundit.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: "This new climate bill is going to destroy the economy."
Reply: "Funny how it's always THIS bill that destroys the economy, every single time one passes."

Tweet: "Both parties are the same at this point."
Reply: "'Both sides are the same' is usually what it feels like right before you stop paying attention to the details."

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

${BANNED_OPENERS}

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
${REPLY_PHILOSOPHY}

First, silently identify:

- What's their situation? Success, frustration, uncertainty?
- What's the most natural reaction — sympathy, a related experience, congrats, a genuine question?

Then write ONE reply that:

- Pick whichever fits: share a specific related experience, react with genuine sympathy or congrats, ask a real follow-up question, or (only if it's genuinely there) notice an assumption or trade-off in their situation. Grounded in their exact situation, not generic.

${BANNED_OPENERS}

DO NOT:

- Give generic advice or generic sympathy ("something better follows", "you got this").
- Sound like a LinkedIn post.
- Over-share.

${analysis ? `Core point: ${analysis.main_point}` : ""}

Examples:

Tweet: "Just got laid off. Feeling lost."
Reply: "It's rarely the job people miss first, it's the schedule that told them who they were."

Tweet: "I've been coding for 10 years and still feel like an imposter."
Reply: "Imposter syndrome doesn't go away because the bar you're measuring against keeps moving with you."

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

  // Style reference from approved replies
  const styleRef = styleReference(memories);

  return `
You are writing replies exactly as I would.

${imageContext}

${analysisContext}

${REPLY_PHILOSOPHY}

First, silently analyze the tweet's context:

- What language and dialect is the tweet written in? (e.g. Nigerian Pidgin, American English, British English, Yoruba, etc.)
- What cultural references does it use? (e.g. Naija slang, US politics, football banter, tech Twitter, etc.)
- What is the author's tone? (e.g. casual, angry, joking, professional, roasting, storytelling)
- What kind of reply would fit this specific context?

${BANNED_OPENERS}

Then write ONE reply that:

- Matches the tweet's language and cultural context. If the tweet is in Pidgin, reply in Pidgin. If it's professional, be professional. If it's roasting, roast back.
- Reacts as if a friend told you this.
- Sounds like a real person on that side of Twitter, not a generic bot.
- Uses contractions (I'll, don't, it's, that's, won't) — real people don't type like a formal essay.
- Reacts emotionally when appropriate: be amused, skeptical, impressed, dismissive, or playfully disagree.
- Uses sentence fragments if it sounds natural. Perfect grammar sounds robotic.

**Length depends on the tweet type:**
- For casual posts, jokes, memes, greetings, short opinions → keep it to 1 sentence, 5-10 words. No essays.
- For politics, news, stories, advice → 1-2 sentences is fine. Add a real take.
- For anything you're unsure about → keep it short. Shorter is always safer.

A bad reply:

- Simply repeats the tweet.
- Says "I agree."
- Gives generic motivation.
- Sounds like ChatGPT.
- States the obvious.
- Uses the wrong dialect or tone for the context.
- Uses transition words like "however", "moreover", "furthermore", "additionally".
- Summarizes or restates what the tweet said instead of reacting to it.
- Explains itself or adds disclaimers like "in my opinion", "I think", "from my perspective".
- Sounds like a LinkedIn post or a news anchor.
- Writes more than 2 sentences for casual posts.
- Uses perfect grammar and formal structure — real Twitter replies are casual.
- Starts with "One thing I'd add," or "One thing to add," — just state your point directly.
- Wraps up with a tidy lesson, moral, or "the real X is..." conclusion instead of leaving a thought open.

Writing style:

${styleGuidance}

Relationship with author:
${relationship}

Tweet type:
${type}

-------------------------

Previous replies I approved (study how I adapt to different contexts)

${examples}

${styleRef}

-------------------------

Current Tweet

${tweet}

Write ONE reply that matches this tweet's context and sounds like me.
`;
}

// Categories substantive enough for an assigned reply mode to make sense.
// Excludes well_wish, greeting, meme, humor, question, sports, news, general
// — those are meant to stay light/quick by design, not just by default.
const MODE_ELIGIBLE_CATEGORIES: TweetCategory[] = ["story", "opinion", "advice", "politics", "career"];

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

  // Build base prompt
  const basePrompt = categoryPromptFn
    ? categoryPromptFn(tweet, analysis)
    : buildGenericPrompt(tweet, relationship, normalized, memories, imageDescriptions, analysis);

  // For eligible, substantive tweets, assign an explicit reply mode from
  // the weighted rotation above instead of leaving "what kind of reply"
  // fully up to the model — see REPLY_MODE_WEIGHTS for why.
  const mode: ReplyMode | null = MODE_ELIGIBLE_CATEGORIES.includes(normalized) ? pickReplyMode() : null;
  const modeBlock = mode ? `\n${REPLY_MODE_BLOCKS[mode]}\n` : "";

  // Append final guardrail — this is the LAST thing ChatGPT sees before writing.
  // Placing it here ensures every single prompt variant gets this reinforcement.
  const finalGuardrail = `\n\nFINAL INSTRUCTIONS — VIOLATIONS GET DELETED:
• Before you write, ask: does this reply say something the tweet didn't already say? If not, it's a summary wearing a reply's clothes — start over.
• Do NOT restate or summarize the tweet, even reworded or dressed up as an "insight." Assume the reader already read the tweet.
• Do NOT start with: "One thing I'd add", "One thing to add", "If that's really what happened", "If that's true", "If this happened", or "If that happened".
• Do NOT write "X wasn't really about Y, it was about Z", "X isn't about Y, it's Z", "That wasn't about X", or "This just proves X" — same cliché reframe/summary trick in different words. This also usually means you're just restating the tweet's own point as a punchline instead of adding something — check for that too.
• Do NOT start with: "I wonder if", "I've noticed", "I'm starting to think", or "Maybe".
• Do NOT start with: "The funny part is", "The painful part is", "The scary part is", "The crazy part is", "The best part is", "The worst part is", or any "The [adjective] part is" framing.
• Do NOT claim you "ordered", "purchased", "bought", "subscribed", "followed", "signed up", "donated", "checked out", "sent a message", or took any action you did not actually take.
• Your reply is an observation, not a transaction. Never invent actions.
• Use simple, everyday words. Write like you're texting a friend — short words, short sentences.
• No fancy words like "authentic", "vibrant", "resonate", "elevate", "journey", "transformative", "meaningful", "impactful", "embrace", "leverage".
• No motivational phrases like "keep pushing", "you got this", "blessings", "manifesting".
• Be plain and direct. If you wouldn't say it to a friend, don't write it.
${mode === "reflective"
  ? `• This reply is in REFLECTIVE MODE (see above) — two developed thoughts in a few short lines is correct here, not a single short line. Still plain, still no fancy words, still not the reframe-reveal trick — just more room.`
  : `• Your goal is to blend in, not to impress. Don't try to sound clever, insightful, or quote-worthy. A short, ordinary reaction is often the best reply — write what you'd actually type from your phone in five seconds, not what would read well in a highlight reel.`}`;

  return basePrompt + modeBlock + finalGuardrail;
}

// Export for testing
export { categoryPrompts };