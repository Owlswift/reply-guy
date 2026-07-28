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

Given a reply to one of Echo's tweets, classify it.

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
AGREEMENT: simple "agree" or "facts" → END_CONVERSATION
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
- END_CONVERSATION: simple agreement, "facts", "this"
- IGNORE: spam, bots, tagging friends
- REPLY_AND_LIKE: when both actions feel natural

Reply text:`;

const OLLAMA_URL = "http://localhost:11434/api/generate";

async function classifyWithOllama(replyText: string): Promise<ReplyClassification | null> {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-oss:20b",
        stream: false,
        prompt: `${CLASSIFICATION_PROMPT}\n"${replyText}"`,
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

/**
 * Fast keyword-based fallback when the LLM is unavailable.
 */
function classifyWithKeywords(replyText: string): ReplyClassification {
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

/**
 * Classify a reply text.
 *
 * Tries the local LLM first. Falls back to keyword heuristics if the LLM
 * is unavailable or returns an invalid result.
 */
export async function classifyReply(replyText: string): Promise<ReplyClassification> {
  // Try LLM first
  const llmResult = await classifyWithOllama(replyText);
  if (llmResult) {
    return llmResult;
  }

  // Fallback to keywords
  return classifyWithKeywords(replyText);
}