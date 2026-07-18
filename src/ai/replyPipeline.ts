import { understandTweet, TweetUnderstanding } from "./understandTweet";
import { brainstormAngles } from "./brainstormAngles";
import { writeReply } from "./writeReply";
import { judgeReplies, JudgedReply } from "./judgeReply";
import { log } from "../utils/logger";

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

// Total generation rounds before falling back to the best-scoring candidate
// seen so far, even if nothing cleared the worth-posting bar.
const MAX_ATTEMPTS = 2;

async function generateRound(
  input: PipelineInput,
  understanding: TweetUnderstanding
): Promise<{ angles: string[]; candidates: Array<{ angle: string; reply: string }>; judged: JudgedReply[] }> {
  // Brainstorm angles, then pick 3 for variety (first, middle, last)
  const allAngles = await brainstormAngles(input.tweet, understanding, 10);
  const angles = [
    allAngles[0] ?? "react naturally",
    allAngles[Math.min(4, allAngles.length - 1)] ?? "make an observation",
    allAngles[allAngles.length - 1] ?? "add perspective",
  ];

  // Write a reply for each angle
  const candidates: Array<{ angle: string; reply: string }> = [];
  for (const angle of angles) {
    const reply = await writeReply({
      tweet: input.tweet,
      author: input.author,
      understanding,
      angle,
      examples: input.examples,
    });
    candidates.push({ angle, reply });
  }

  // Judge whether any candidate is actually worth posting
  const judged = await judgeReplies(input.tweet, candidates.map(c => c.reply));

  return { angles, candidates, judged };
}

/**
 * Full reply pipeline:
 *
 * 1. Understand — analyze the tweet deeply
 * 2. Brainstorm — generate 10 reply angles
 * 3. Write — write 3 replies from the best angles
 * 4. Judge — does any reply actually make the thread better?
 *
 * If nothing clears the "worth posting" bar, regenerate with fresh angles
 * (up to MAX_ATTEMPTS rounds) rather than posting generic filler. If every
 * round comes up empty, fall back to the best-scoring candidate seen
 * across all rounds so the item doesn't just fail outright.
 */
export async function runReplyPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const understanding = await understandTweet(input.tweet, input.author);

  let best: { angles: string[]; candidates: Array<{ angle: string; reply: string }>; judged: JudgedReply[] } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const round = await generateRound(input, understanding);

    if (!best || (round.judged[0]?.score ?? 0) > (best.judged[0]?.score ?? -1)) {
      best = round;
    }

    if (round.judged[0]?.worthPosting) {
      break;
    }

    if (attempt < MAX_ATTEMPTS) {
      log(`Reply round ${attempt} had nothing worth posting — regenerating.`);
    }
  }

  if (best && !best.judged[0]?.worthPosting) {
    log(`No reply cleared the bar after ${MAX_ATTEMPTS} rounds — using best-effort fallback (score ${best.judged[0]?.score ?? 0}).`);
  }

  const { angles, candidates, judged } = best!;
  const bestReply = judged[0]?.reply ?? candidates[0]?.reply ?? "";

  return {
    understanding,
    angles,
    candidates,
    judged,
    bestReply,
  };
}