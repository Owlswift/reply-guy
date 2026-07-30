import { TweetCategory } from "../types/analysis";

/**
 * Per-category odds that Echo replies at all, replacing a single flat
 * content-blind coin flip (behavior/scheduler.ts's old getReplyRatio()) at
 * main-interactive.ts's enqueue-time gate. A real account's odds of
 * commenting vary a lot by what kind of post it is — people almost always
 * weigh in on a direct question, but often just scroll past a meme, a vague
 * opinion take, or a news post without saying anything.
 */
const REPLY_PROBABILITY: Record<TweetCategory, number> = {
  question: 0.9,
  story: 0.75,
  advice: 0.7,
  career: 0.65,
  humor: 0.65,
  opinion: 0.55,
  politics: 0.55,
  meme: 0.5,
  news: 0.5,
  sports: 0.5,
  general: 0.5,
  // well_wish/greeting never actually reach this gate — main-interactive.ts
  // routes them to the manual-reply special case first. Included for
  // completeness/type-safety only.
  well_wish: 0.6,
  greeting: 0.6,
};

export function replyProbabilityFor(category: TweetCategory): number {
  return REPLY_PROBABILITY[category] ?? 0.6;
}
