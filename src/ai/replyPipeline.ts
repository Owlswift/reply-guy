import { understandTweet, TweetUnderstanding } from "./understandTweet";
import { brainstormAngles } from "./brainstormAngles";
import { writeReply } from "./writeReply";
import { judgeReplies, JudgedReply } from "./judgeReply";

export interface PipelineInput {
  tweet: string;
  author?: string;
  examples?: Array<{ tweet: string; reply: string }>;
}

export interface PipelineOutput {
  understanding: TweetUnderstanding;
  angles: string[];
  candidates: Array<{ angle: string; reply: string }>;
  judged: JudgedReply[];
  bestReply: string;
}

/**
 * Full reply pipeline:
 * 
 * 1. Understand — analyze the tweet deeply
 * 2. Brainstorm — generate 10 reply angles
 * 3. Write — write 3 replies from the best angles
 * 4. Judge — score all replies and pick the best
 */
export async function runReplyPipeline(input: PipelineInput): Promise<PipelineOutput> {
  // Step 1: Understand
  const understanding = await understandTweet(input.tweet, input.author);

  // Step 2: Brainstorm angles
  const allAngles = await brainstormAngles(input.tweet, understanding, 10);

  // Pick top 3 angles (first, middle, last for variety)
  const selectedAngles = [
    allAngles[0] ?? "react naturally",
    allAngles[Math.min(4, allAngles.length - 1)] ?? "make an observation",
    allAngles[allAngles.length - 1] ?? "add perspective",
  ];

  // Step 3: Write a reply for each angle
  const candidates: Array<{ angle: string; reply: string }> = [];
  for (const angle of selectedAngles) {
    const reply = await writeReply({
      tweet: input.tweet,
      author: input.author,
      understanding,
      angle,
      examples: input.examples,
    });
    candidates.push({ angle, reply });
  }

  // Step 4: Judge all candidates
  const judged = await judgeReplies(
    input.tweet,
    candidates.map(c => c.reply)
  );

  // Pick the best
  const bestReply = judged[0]?.reply ?? candidates[0]?.reply ?? "";

  return {
    understanding,
    angles: selectedAngles,
    candidates,
    judged,
    bestReply,
  };
}