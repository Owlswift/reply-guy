import ollama from "ollama";

export interface ReplyInput {
  author: string;
  tweet: string;
}

export interface GenerationContext {
  analysis?: {
    type: string;
    tone: string;
    main_point: string;
    best_reply_style: string;
  } | undefined;
  examples?: Array<{
    tweet: string;
    reply: string;
  }> | undefined;
}

const recentReplies: string[] = [];

export function isGoodReply(reply: string): boolean {
  if (reply.length < 8) return false;
  if (reply.length > 220) return false;
  if (reply.includes("#")) return false;
  if (/[\u{1F300}-\u{1F9FF}]/u.test(reply)) return false;
  return true;
}

const SYSTEM_PROMPT = `
You write replies on X.

Your goal is to sound like a smart human, not an assistant.

Before replying, silently determine:

- What kind of tweet is this?
  (story, joke, opinion, news, advice, question, announcement)

- Why would people engage with it?

- What is the most interesting angle to reply from?

Then write ONE reply.

A good reply should do ONE of these:

- Extend the joke.
- Add another perspective.
- Make an observation.
- Add a relatable experience.
- Lightly challenge the idea.
- Complete the thought.

Avoid:

- Repeating the tweet.
- Explaining the tweet.
- Generic motivation.
- Giving lectures.
- Inventing details.
- Asking unnecessary questions.
- Sounding like ChatGPT.
- Using hashtags.
- Using emojis.
- Using quotation marks.

Write like someone who has spent years on X.

Maximum 25 words.

Output ONLY the reply.
`.trim();

function buildUserPrompt(
  author: string,
  tweet: string,
  context?: GenerationContext
): string {
  const parts: string[] = [];

  // Analysis context if available
  if (context?.analysis) {
    parts.push(`Analysis:
Type: ${context.analysis.type}
Tone: ${context.analysis.tone}
Main point: ${context.analysis.main_point}
Best reply style: ${context.analysis.best_reply_style}
`);
  }

  // Few-shot examples from approved replies
  if (context?.examples && context.examples.length > 0) {
    parts.push("Examples of good replies:");
    for (const ex of context.examples.slice(0, 5)) {
      parts.push(`
Tweet: ${ex.tweet}
Reply: ${ex.reply}
`);
    }
  }

  // Current tweet
  parts.push(`Author:
@${author.replace(/^@/, "")}

Tweet:
${tweet}

Task:

First understand why this tweet is engaging.

Then write ONE reply that people would naturally like.

Do NOT explain the tweet.

Do NOT summarize it.

Join the conversation.`);

  return parts.join("\n\n");
}

export async function generateReply(
  input: ReplyInput | string,
  context?: GenerationContext
): Promise<string> {
  const author = typeof input === "string" ? "Unknown" : input.author;
  const tweet = typeof input === "string" ? input : input.tweet;

  const response = await ollama.chat({
    model: "gpt-oss:20b",
    options: {
      temperature: 0.9,
    },
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildUserPrompt(author, tweet, context),
      },
    ],
  });

  let reply = response.message.content.trim();

  // Strip leading bullet points or dashes
  reply = reply.replace(/^[-*•]\s*/, "");
  // Replace dashes used as a clause break (" - ", " \u2014 ", " \u2013 ") with a comma \u2014
  // not a blanket strip, which used to delete the dash out of compound words
  // too (e.g. "well-wish" -> "wellwish"). Only a dash with whitespace on
  // both sides is a clause break; a bare hyphen between two words is a
  // normal compound word and stays untouched. En/em dashes (\u2013, \u2014)
  // are never legitimate mid-word joiners, so those become a comma either way.
  reply = reply
    .replace(/\s+[\-\u2011\u2013\u2014]\s+/g, ", ")
    .replace(/[\u2013\u2014]/g, ", ")
    .replace(/,\s*,+/g, ",")
    .replace(/\s+,/g, ",")
    .trim();

  return reply;
}

// Generate with quality control and deduplication
export async function generateGoodReply(
  input: ReplyInput | string,
  context?: GenerationContext,
  maxAttempts = 3
): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const reply = await generateReply(input, context);

    if (!isGoodReply(reply)) {
      continue;
    }

    // Check for similarity with recent replies
    const isDuplicate = recentReplies.some(
      (r) => r.toLowerCase() === reply.toLowerCase()
    );

    if (isDuplicate) {
      continue;
    }

    // Add to recent replies (keep last 20)
    recentReplies.push(reply);
    if (recentReplies.length > 20) {
      recentReplies.shift();
    }

    return reply;
  }

  return null;
}