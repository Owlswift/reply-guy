import { TimelineTweet } from "../types/tweet";

/**
 * Priority handles — tweets from these authors get a flat score bonus
 * so they rank higher in the queue regardless of age/replies.
 * Edit this list to add your priority accounts.
 */
const PRIORITY_HANDLES: string[] = [
  // Add handles here e.g. "elonmusk", "fabrizioromano"
  "@EricLDaugh",
  "@Read_Meee",
  "@KAHALA123Y",
  "@AlexHormozi",
  "@piersmorgan",
  "@wak2433",
  "@unkonfined",
  "@Anathenumberone"
];

const PRIORITY_BONUS = 30; // flat score boost for priority handles

/**
 * Urgent handles — tweets from these authors are treated with maximum priority.
 * They bypass age/reply skips, spam filters, and score thresholds.
 * The massive bonus ensures they always rank at the top of the queue.
*/
const URGENT_HANDLES: string[] = [
  "@sama",
  "@WatcherGuru"
];

const URGENT_BONUS = 1000; // massive score boost for urgent handles

/**
 * Compute how visible a new reply on this tweet is likely to be.
 *
 * We care about two things:
 *   1. Age — how recently was it posted? (dominant factor)
 *   2. Reply count — how crowded is the discussion already?
 *
 * Scoring formula:
 *
 *   AgeScore  (0–100)  = 45% weight
 *   ReplyScore (0–100) = 30% weight
 *   AuthorScore (0–100) = 10% weight
 *   RelationshipScore (0–100) = 5% weight
 *   TopicScore (0–100) = 10% weight
 *   PriorityBonus = flat +30 if author is in priority list
 *
 * Total = AgeScore * 0.45 + ReplyScore * 0.30 + AuthorScore * 0.10
 *       + RelationshipScore * 0.05 + TopicScore * 0.10 + PriorityBonus
 */

// ──────────────────────────────────────────────────
// Age buckets
// ──────────────────────────────────────────────────
const AGE_BUCKETS: [number, number][] = [
  [0, 10],    // 0–10 min  → Immediate
  [10, 30],   // 10–30 min → Hot
  [30, 60],   // 30–60 min → Warm
  [60, 180],  // 1–3 hr    → Cooling
  // > 3 hr    → Cold (skip)
];

function ageScore(ageMinutes: number): number {
  if (ageMinutes <= 10)  return 100;   // Immediate
  if (ageMinutes <= 30)  return 80;    // Hot
  if (ageMinutes <= 60)  return 50;    // Warm
  if (ageMinutes <= 180) return 20;    // Cooling
  return 0;                            // Cold
}

// ──────────────────────────────────────────────────
// Reply count buckets
// ──────────────────────────────────────────────────
function replyScore(replyCount: number): number {
  if (replyCount <= 20)     return 100;  // Wide open
  if (replyCount <= 50)     return 80;   // Still good
  if (replyCount <= 100)    return 60;   // Moderate
  if (replyCount <= 250)    return 30;   // Crowded
  if (replyCount <= 500)    return 10;   // Very crowded
  return 0;                               // Saturated
}

// ──────────────────────────────────────────────────
// Author score (verified, follower count inference)
// ──────────────────────────────────────────────────
function authorScore(verified: boolean, likes: number): number {
  let score = 0;
  if (verified) score += 50;
  // More likes → higher-authority tweet
  if (likes > 100)   score += 10;
  if (likes > 1000)  score += 20;
  if (likes > 10000) score += 30;
  return Math.min(score, 100);
}

// ──────────────────────────────────────────────────
// Relationship score
// ──────────────────────────────────────────────────
function relationshipScore(following: boolean): number {
  if (following) return 100;
  return 0;
}

// ──────────────────────────────────────────────────
// Topic score — currently a passthrough placeholder
// Future: classify tweet topic and boost sports/news
// ──────────────────────────────────────────────────
function topicScore(_text: string): number {
  return 50; // neutral baseline
}

// ──────────────────────────────────────────────────
// Main scorer
// ──────────────────────────────────────────────────

/**
 * Check if the author is an urgent handle.
 */
export function isUrgent(author: string, username: string): boolean {
  const normalized = author.replace(/^@/, "").toLowerCase();
  const normalizedUser = username.toLowerCase();
  return URGENT_HANDLES.some(
    h => normalized === h.toLowerCase() || normalizedUser === h.toLowerCase()
  );
}

/**
 * Check if the author is a priority handle and return bonus.
 */
function priorityBonus(author: string, username: string): number {
  const normalized = author.replace(/^@/, "").toLowerCase();
  const normalizedUser = username.toLowerCase();
  return PRIORITY_HANDLES.some(
    h => normalized === h.toLowerCase() || normalizedUser === h.toLowerCase()
  ) ? PRIORITY_BONUS : 0;
}

/**
 * Check if the author is an urgent handle and return the urgent bonus.
 */
function urgentBonus(author: string, username: string): number {
  return isUrgent(author, username) ? URGENT_BONUS : 0;
}

export function scoreTweet(tweet: TimelineTweet): number {
  const now = Date.now();
  const ageMs = now - tweet.createdAt.getTime();
  const ageMinutes = Math.max(0, ageMs / 60_000);

  const aScore  = ageScore(ageMinutes);
  const rScore  = replyScore(tweet.replies);
  const auScore = authorScore(tweet.verified, tweet.likes);
  const relScore = relationshipScore(tweet.following);
  const tScore  = topicScore(tweet.text);
  const pBonus  = priorityBonus(tweet.author, tweet.username);
  const uBonus  = urgentBonus(tweet.author, tweet.username);

  // Weighted sum + priority bonus + urgent bonus
  const total =
    aScore  * 0.45 +
    rScore  * 0.30 +
    auScore * 0.10 +
    relScore * 0.05 +
    tScore  * 0.10 +
    pBonus +
    uBonus;

  // Round to integer
  return Math.round(total);
}

// ──────────────────────────────────────────────────
// Decision helpers
// ──────────────────────────────────────────────────

/**
 * Should we skip this tweet entirely based on age + reply count?
 *
 * The matrix:
 *   - Age > 3 hr → skip regardless
 *   - Age > 1 hr AND replies > 100 → skip
 *   - Age > 30 min AND replies > 250 → skip
 */
export function shouldSkipDueToAgeAndReplies(tweet: TimelineTweet): boolean {
  // Urgent handles (e.g. @WatcherGuru) are never skipped due to age/replies
  if (isUrgent(tweet.author, tweet.username)) return false;

  const now = Date.now();
  const ageMs = now - tweet.createdAt.getTime();
  const ageMinutes = Math.max(0, ageMs / 60_000);

  if (ageMinutes > 180) return true;                 // > 3 hr → skip
  if (ageMinutes > 60 && tweet.replies > 100) return true;   // > 1 hr + crowded
  if (ageMinutes > 30 && tweet.replies > 250) return true;   // > 30 min + very crowded
  return false;
}
