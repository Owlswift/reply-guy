import ollama from "ollama";

export interface ReplyInput {
  author: string;
  tweet: string;
}

const recentReplies: string[] = [];

export function isGoodReply(reply: string): boolean {
  if (reply.length < 8)
    return false;

  if (reply.length > 220)
    return false;

  if (reply.includes("#"))
    return false;

  if (/[\u{1F300}-\u{1F9FF}]/u.test(reply))
    return false;

  return true;
}

export async function generateReply(input: ReplyInput | string): Promise<string> {
  // Support both old string format and new object format
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
        content: `
You are replying on X.

Write ONE natural reply.

Rules:

Maximum 25 words.

No hashtags.

No quotation marks.

No dashes (-).

No AI language.

Don't flatter people.

Don't always agree.

Be conversational.

Match the tone of the tweet — if it's a greeting, reply with a simple greeting. If it's serious, be serious. If it's casual, be casual.

Do not add political commentary unless the tweet is explicitly about politics.

Do not start with a dash, asterisk, or any bullet point character.
`
      },
      {
        role: "user",
        content: `
Author:

${author}

Tweet:

${tweet}
`
      }
    ]
  });

  let reply = response.message.content.trim();

  // Strip dashes, asterisks, or bullet-point characters that models sometimes add
  reply = reply.replace(/^[-*•]\s*/, "");
  reply = reply.replace(/-/g, "");

  return reply;
}

// Generate with quality control and deduplication
export async function generateGoodReply(input: ReplyInput | string, maxAttempts = 3): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const reply = await generateReply(input);
    
    if (!isGoodReply(reply)) {
      continue;
    }

    // Check for similarity with recent replies
    const isDuplicate = recentReplies.some(r => 
      r.toLowerCase() === reply.toLowerCase()
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