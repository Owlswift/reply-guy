import { ReplyClass, ReplyClassification, EngagementDecision } from "./types";

/**
 * Classify a reply using the local LLM (Ollama).
 *
 * Returns a structured JSON with:
 *   - replyClass: what kind of reply this is
 *   - engagementDecision: what Echo should do
 *   - reason: why
 *
 * Falls back to keyword-based heuristics if the LLM is unavailable.
 */
const CLASSIFICATION_PROMPT = `You are a reply classifier for a Twitter engagement bot called Echo.

Given a reply to one of Echo's tweets, classify it. You are also given the
original post it's replying to — use it to tell genuine agreement/restatement
apart from a reply that only shares some words with the original by coincidence.

Output ONLY valid JSON with these fields:
{
  "replyClass": "QUESTION" | "GREETINGS" | "WELL_WISH" | "DISAGREEMENT" | "AGREEMENT" | "JOKE" | "SHARING_EXPERIENCE" | "FOLLOW_UP" | "PRAISE" | "CRITICISM" | "THANK_YOU" | "SPAM" | "BOT" | "EMOJI_ONLY" | "TAGGING_FRIEND" | "MISUNDERSTANDING",
  "engagementDecision": "IGNORE" | "LIKE_ONLY" | "REPLY" | "REPLY_AND_LIKE" | "END_CONVERSATION",
  "reason": "brief explanation"
}

Classification rules by reply class:

QUESTION: asks something specific → REPLY
GREETINGS: "hey", "hello", "what's up" → REPLY
WELL_WISH: "good luck", "congrats" → LIKE_ONLY
DISAGREEMENT: pushes back on the content → REPLY
AGREEMENT: simple "agree" or "facts", OR a longer sentence that just restates/paraphrases the original post's own point in different words without adding any new angle, detail, or information → END_CONVERSATION
JOKE: makes a joke → REPLY if you have something funny, else LIKE_ONLY
SHARING_EXPERIENCE: shares a related experience → REPLY
FOLLOW_UP: expands the discussion ("what if...", "interesting...") → REPLY
PRAISE: "great post", "nice" → LIKE_ONLY
CRITICISM: substantive criticism → REPLY
THANK_YOU: "thanks", "appreciate it" → LIKE_ONLY
SPAM: "check my profile", link dropping → IGNORE
BOT: clearly a bot account → IGNORE
EMOJI_ONLY: only emojis → LIKE_ONLY
TAGGING_FRIEND: just tagging someone → IGNORE
MISUNDERSTANDING: clearly misunderstood the post → REPLY

Decision priority:
- REPLY: answer questions, address disagreements, respond to criticism, follow up with expanding comments
- LIKE_ONLY: praise, thank you, emoji only, well wishes
- END_CONVERSATION: simple agreement, "facts", "this", or a reply that just reworded the original post's own point back — restating it isn't new information and doesn't need a full reply
- IGNORE: spam, bots, tagging friends
- REPLY_AND_LIKE: when both actions feel natural`;

const OLLAMA_URL = "http://localhost:11434/api/generate";

async function classifyWithOllama(
  replyText: string,
  originalTweetText: string
): Promise<ReplyClassification | null> {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-oss:20b",
        stream: false,
        prompt: `${CLASSIFICATION_PROMPT}\n\nOriginal post: "${originalTweetText}"\nReply: "${replyText}"`,
        options: {
          temperature: 0.1,
          top_p: 0.9,
        },
      }),
    });

    const data = (await response.json()) as { response: string };
    const raw = data.response.trim();

    // Try to extract JSON from the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as ReplyClassification;

    // Validate the parsed result
    const validClasses = [
      "QUESTION", "GREETINGS", "WELL_WISH", "DISAGREEMENT", "AGREEMENT", "JOKE",
      "SHARING_EXPERIENCE", "FOLLOW_UP", "PRAISE", "CRITICISM",
      "THANK_YOU", "SPAM", "BOT", "EMOJI_ONLY", "TAGGING_FRIEND",
      "MISUNDERSTANDING",
    ];
    const validDecisions = ["IGNORE", "LIKE_ONLY", "REPLY", "REPLY_AND_LIKE", "END_CONVERSATION"];

    if (
      validClasses.includes(parsed.replyClass) &&
      validDecisions.includes(parsed.engagementDecision)
    ) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

const STOPWORDS = new Set([
  "that", "this", "there", "their", "about", "which", "would", "could",
  "should", "already", "before", "after", "still", "again", "being",
  "have", "with", "from", "were", "into", "than", "then", "just", "more",
  "very", "story", "clearly", "really",
]);

// Significant (4+ letter, non-stopword) words, truncated to a 5-char prefix
// as a crude stem (confident/confidence, knew/knows) — for a rough overlap
// check, not a real semantic comparison. Just enough to catch a reply
// that's obviously the same sentence in different words.
function significantWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z']{4,}/g) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)).map((w) => w.slice(0, 5)));
}

// Does replyText just restate originalText's point rather than add anything
// new? Approximated as: most of the reply's significant words already
// appear in the original post. Only meaningful for longer replies — a short
// one sharing a couple of words with the original is normal overlap, not
// restatement.
function isLikelyParaphrase(replyText: string, originalText: string): boolean {
  const replyWords = significantWords(replyText);
  if (replyWords.size < 4) return false;

  const originalWords = significantWords(originalText);
  const shared = [...replyWords].filter((w) => originalWords.has(w));
  return shared.length / replyWords.size >= 0.5;
}

/**
 * Fast keyword-based fallback when the LLM is unavailable.
 */
function classifyWithKeywords(replyText: string, originalTweetText?: string): ReplyClassification {
  const t = replyText.trim().toLowerCase();

  // Emoji only
  if (/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+$/u.test(t)) {
    return { replyClass: "EMOJI_ONLY", engagementDecision: "LIKE_ONLY", reason: "emoji-only reply" };
  }

  // Tagging a friend — just a mention with no other text
  if (/^@\w+\s*$/.test(t) || /^(cc|via)\s+@\w+/i.test(t)) {
    return { replyClass: "TAGGING_FRIEND", engagementDecision: "IGNORE", reason: "just tagging someone" };
  }

  // Spam signals
  if (
    /\b(check|visit|follow|dm)\s+(my|me)\b/i.test(t) ||
    /\b(link|bio|profile)\b/i.test(t) ||
    /http/i.test(t)
  ) {
    return { replyClass: "SPAM", engagementDecision: "IGNORE", reason: "spam signals detected" };
  }

  // Bot signals
  if (
    /\b(ai|bot|automated|auto.?reply)\b/i.test(t) &&
    !/\b(ai|bot)\b/i.test(t) // only if they're calling US a bot
  ) {
    return { replyClass: "BOT", engagementDecision: "IGNORE", reason: "likely a bot account" };
  }

  // Question
  if (/\?/.test(t)) {
    return { replyClass: "QUESTION", engagementDecision: "REPLY", reason: "asked a question" };
  }

  // Thank you
  if (/\b(thanks|thank you|appreciate|ty)\b/i.test(t)) {
    return { replyClass: "THANK_YOU", engagementDecision: "LIKE_ONLY", reason: "thank you reply" };
  }

  // Simple agreement
  if (
    /^(facts|this|exactly|true|real|100%|agreed|co-sign|co sign)\b/i.test(t) ||
    /^this\s*$/.test(t)
  ) {
    return { replyClass: "AGREEMENT", engagementDecision: "END_CONVERSATION", reason: "simple agreement" };
  }

  // Praise
  if (
    /\b(great|awesome|amazing|love this|fire|dope|solid|nice|good post|great post|wow)\b/i.test(t) &&
    t.length < 40
  ) {
    return { replyClass: "PRAISE", engagementDecision: "LIKE_ONLY", reason: "praise" };
  }

  // Disagreement
  if (
    /\b(disagree|wrong|incorrect|not true|actually|but|however|disagree|nah|nope|cap)\b/i.test(t)
  ) {
    return { replyClass: "DISAGREEMENT", engagementDecision: "REPLY", reason: "disagreement" };
  }

  // Paraphrased restatement — a longer sentence that just reasserts the
  // original post's own point in different words, without pushing back on
  // it (already ruled out above) or adding anything new.
  if (originalTweetText && isLikelyParaphrase(t, originalTweetText)) {
    return { replyClass: "AGREEMENT", engagementDecision: "END_CONVERSATION", reason: "restates the original post's point" };
  }

  // Sharing experience
  if (
    /\b(this happened|same thing|me too|happened to me|i had|i experienced|similar|relatable)\b/i.test(t)
  ) {
    return { replyClass: "SHARING_EXPERIENCE", engagementDecision: "REPLY", reason: "sharing experience" };
  }

  // Follow-up / expanding discussion
  if (
    /\b(what if|imagine if|interesting|curious|wonder if|follow.up|expand|elaborate)\b/i.test(t)
  ) {
    return { replyClass: "FOLLOW_UP", engagementDecision: "REPLY", reason: "expanding discussion" };
  }

  // Criticism
  if (
    /\b(bad|terrible|awful|worst|hate|dislike|not good|missed|overrated|underwhelming)\b/i.test(t)
  ) {
    return { replyClass: "CRITICISM", engagementDecision: "REPLY", reason: "criticism" };
  }

  // Joke
  if (
    /😂|🤣|💀|lol|lmao|lmfao/i.test(t)
  ) {
    return { replyClass: "JOKE", engagementDecision: "LIKE_ONLY", reason: "joke/humor" };
  }

  // Default — if we can't classify, treat as a follow-up to be safe
  return { replyClass: "FOLLOW_UP", engagementDecision: "REPLY", reason: "unclassified, defaulting to reply" };
}

// Odds Echo actually engages (replies, or posts a closing reaction) with a
// legitimate comment, rather than a real person seeing it and just... not
// responding. A human doesn't answer every comment on their own posts, even
// good-faith ones. Only applies to classes that would otherwise ALWAYS
// trigger a visible action (REPLY/REPLY_AND_LIKE/END_CONVERSATION) —
// classes that already resolve to LIKE_ONLY or IGNORE are untouched.
const ENGAGEMENT_PROBABILITY: Partial<Record<ReplyClass, number>> = {
  QUESTION: 0.95,
  GREETINGS: 0.7,
  DISAGREEMENT: 0.85,
  AGREEMENT: 0.5,
  JOKE: 0.6,
  SHARING_EXPERIENCE: 0.75,
  FOLLOW_UP: 0.8,
  CRITICISM: 0.85,
  MISUNDERSTANDING: 0.85,
};

// When the roll fails, REPLY/REPLY_AND_LIKE downgrade to LIKE_ONLY. Despite
// the name, LIKE_ONLY doesn't mean silent-except-for-a-like here — see
// notifications.ts/engage.ts, it posts a short canned closing reaction
// (postClosingReaction). There's no actual like-button click implemented
// anywhere in this codebase yet (every `[data-testid="like"]` reference is
// read-only, for scoring), so genuine "liked but said nothing" isn't
// available as an action to fall back to — this trades a full generated
// reply for a short reaction instead of true silence.
//
// END_CONVERSATION downgrades to IGNORE instead — a real, total skip, not
// LIKE_ONLY. notifications.ts/engage.ts route END_CONVERSATION and
// LIKE_ONLY through that exact same closing-reaction code path, so
// downgrading END_CONVERSATION to LIKE_ONLY would have been a no-op: a
// simple closing remark ("yup", "same here") would ALWAYS get a reaction
// posted regardless of this roll. A real person doesn't answer every "yup"
// someone posts just to close out a thread — some of these deserve no
// response at all.
function applyEngagementProbability(classification: ReplyClassification): ReplyClassification {
  const { replyClass, engagementDecision } = classification;
  const isAlwaysActive =
    engagementDecision === "REPLY" ||
    engagementDecision === "REPLY_AND_LIKE" ||
    engagementDecision === "END_CONVERSATION";
  if (!isAlwaysActive) return classification;

  const probability = ENGAGEMENT_PROBABILITY[replyClass];
  if (probability === undefined || Math.random() <= probability) return classification;

  const downgradeTo = engagementDecision === "END_CONVERSATION" ? "IGNORE" : "LIKE_ONLY";
  const reasonSuffix = downgradeTo === "IGNORE" ? "ignoring entirely" : "short reaction instead of a full reply";

  return {
    ...classification,
    engagementDecision: downgradeTo,
    reason: `${classification.reason} (rolled below ${Math.round(probability * 100)}% engagement odds for ${replyClass} — ${reasonSuffix})`,
  };
}

/**
 * Classify a reply text.
 *
 * Tries the local LLM first. Falls back to keyword heuristics if the LLM
 * is unavailable or returns an invalid result. Either way, the result then
 * passes through applyEngagementProbability() so not every legitimate
 * comment gets a guaranteed reply.
 */
export async function classifyReply(
  replyText: string,
  originalTweetText: string
): Promise<ReplyClassification> {
  // Try LLM first
  const llmResult = await classifyWithOllama(replyText, originalTweetText);
  if (llmResult) {
    return applyEngagementProbability(llmResult);
  }

  // Fallback to keywords
  return applyEngagementProbability(classifyWithKeywords(replyText, originalTweetText));
}