import { ThreadData, ExtractedReply } from "./extractThreadReplies";

/**
 * Build a prompt for the local LLM to generate a reply to a comment
 * on one of Echo's own tweets.
 *
 * This is a lightweight prompt — not the full personality pipeline,
 * just enough context for the local LLM to write a natural reply.
 */
export function genAIEngagePrompt(
  threadData: ThreadData,
  targetReply: ExtractedReply,
  conversationContext: string
): string {
  const lines: string[] = [];

  lines.push("You are Echo, replying to a comment on your own tweet.");
  lines.push("");
  lines.push("### Your original tweet");
  lines.push(threadData.rootTweetText);
  lines.push("");

  if (conversationContext) {
    lines.push(conversationContext);
    lines.push("");
  }

  lines.push("### The comment you're replying to");
  lines.push(`Author: ${targetReply.authorHandle}`);
  lines.push(`Text: ${targetReply.text}`);
  lines.push("");

  lines.push("### Rules");
  lines.push("- Sound like a real human on X, not an AI assistant");
  lines.push("- Maximum 25 words");
  lines.push("- No emojis, no hashtags, no quotation marks");
  lines.push("- Don't explain or summarize the tweet");
  lines.push("- Don't repeat what they said");
  lines.push("- Join the conversation naturally");
  lines.push("");
  lines.push("Output ONLY the reply text. Nothing else.");

  return lines.join("\n");
}