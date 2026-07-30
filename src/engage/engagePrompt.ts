import { ThreadData, ExtractedReply } from "./extractThreadReplies";
import { ReplyMemory } from "../types/memory";

/**
 * Build a prompt for the local LLM to generate a reply to a comment
 * on one of Echo's own tweets.
 *
 * This is a lightweight prompt — not the full personality pipeline,
 * just enough context for the local LLM to write a natural reply.
 * Callers must send this to the model as-is (e.g. ChatGPTClient's
 * generateRawReply) — routing it back through the standalone-tweet
 * personality pipeline (buildPrompt/classifyTweet/buildPersonalityPrompt)
 * re-classifies this whole prompt as if it were the tweet being replied
 * to, and wraps it in category instructions that can directly contradict
 * a reply that's addressed to a specific commenter (e.g. "you are NOT
 * replying to them directly").
 */
export function genAIEngagePrompt(
  threadData: ThreadData,
  targetReply: ExtractedReply,
  conversationContext: string,
  memories: ReplyMemory[] = [],
  verifiedParent?: { author: string; text: string; isRoot: boolean }
): string {
  const lines: string[] = [];

  lines.push("You are Echo, replying to a comment on your own tweet.");
  lines.push("");
  lines.push("### Background: your original tweet (context only — you are NOT replying to this)");
  lines.push(threadData.rootTweetText);
  lines.push("");

  if (verifiedParent && !verifiedParent.isRoot) {
    lines.push(`### IMPORTANT: this comment is a NESTED reply — it's actually responding to ${verifiedParent.author || "another commenter"}, not directly to your original tweet`);
    lines.push(`${verifiedParent.author || "They"} said: ${verifiedParent.text}`);
    lines.push("Keep this in mind — the comment below is reacting to THAT, so your reply may need to make sense in light of it, not just the root tweet.");
    lines.push("");
  }

  if (conversationContext) {
    lines.push(conversationContext);
    lines.push("");
  }

  const styleExamples = memories
    .filter((m) => m.approved && m.finalReply && m.finalReply.length > 0)
    .slice(0, 8);
  if (styleExamples.length > 0) {
    lines.push("### Your writing style (from replies you approved before)");
    for (const m of styleExamples) {
      lines.push(`- "${m.finalReply}"`);
    }
    lines.push("Match this tone and voice — but only in HOW you write, not WHAT you say. WHAT you say must come from the comment below.");
    lines.push("");
  }

  lines.push("### THE COMMENT YOU ARE REPLYING TO — respond to this, specifically");
  lines.push(`Author: ${targetReply.authorHandle}`);
  lines.push(`Text: ${targetReply.text}`);
  lines.push("");

  lines.push("### Rules");
  lines.push("- Your reply must engage with what THIS COMMENT said — its specific point, question, or tone — not just the original tweet's topic");
  lines.push("- If they disagreed, answer the disagreement; if they asked something, answer it; if they joked, riff on their joke. Don't default to restating your own tweet");
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