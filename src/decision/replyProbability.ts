import { TweetCategory } from "../types/analysis";

/**
 * Per-category odds that Echo replies at all, replacing a single flat
 * content-blind coin flip (behavior/scheduler.ts's old getReplyRatio()) at
 * main-interactive.ts's enqueue-time gate. A real account's odds of
 * commenting vary a lot by what kind of post it is — people almost always
 * weigh in on a direct question, but often just scroll past a meme, a vague
 * opinion take, or a news post without saying anything.
 *
 * Retuned per the shift from maximizing reply volume to maximizing reply
 * quality — priority given to story threads, politics/current affairs,
 * opinion/advice posts that invite real discussion, and
 * career/business/educational content; odds lowered for categories that
 * mostly invite a disposable reaction (meme, general chatter, sports) —
 * this is a secondary layer on top of the hard hourly reply cap
 * (storage/hourlyReplyQuota.ts), which does most of the actual
 * volume-limiting now.
 */
const REPLY_PROBABILITY: Record<TweetCategory, number> = {
  question: 0.9,
  story: 0.85,
  politics: 0.8,
  opinion: 0.75,
  advice: 0.75,
  career: 0.7,
  news: 0.5,
  humor: 0.4,
  sports: 0.4,
  general: 0.35,
  meme: 0.3,
  // well_wish/greeting never actually reach this gate — main-interactive.ts
  // routes them to the manual-reply special case first. Included for
  // completeness/type-safety only.
  well_wish: 0.6,
  greeting: 0.6,
};

export function replyProbabilityFor(category: TweetCategory): number {
  return REPLY_PROBABILITY[category] ?? 0.6;
}
