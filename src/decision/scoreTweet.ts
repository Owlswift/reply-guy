import { TimelineTweet } from "../types/tweet";

/**
 * Normalize a handle for comparison: pull out the @handle if it's embedded
 * in a longer string (TimelineTweet.author is the raw display-name text,
 * e.g. "S writes@WrittenBy_SS", not just the handle), strip the leading
 * @, lowercase. Applying this to BOTH sides of every comparison below is
 * load-bearing — a previous version stripped @ from the handle list but
 * not from the tweet's own username field, so e.g. isTopPriority() was
 * comparing "@writtenby_ss" against "writtenby_ss" and could never match.
 */
function normalizeHandle(value: string): string {
  const match = value.match(/@\w+/);
  return (match ? match[0] : value).replace(/^@/, "").toLowerCase();
}

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
  "@wak2433",
  "@KINGGGE_",
  "@Anathenumberone",
  "@theladymotara",
  "@ok6ixx",
  "@GuntherEagleman",
  "@lizzkelly7",
  "@onjolo_kenya",
  "@6th_july",
  "@RiddleSphere",
  "@Drew_Scarlet98",
  "@cutelipsxx",
  "cyberfeeels"
];

const PRIORITY_BONUS = 30; // flat score boost for priority handles

/**
 * Urgent handles — tweets from these authors are treated with maximum priority.
 * They bypass age/reply skips, spam filters, and score thresholds.
 * The massive bonus ensures they always rank at the top of the queue.
*/
const URGENT_HANDLES: string[] = [
  "@PlanetOfMemes",
  "@QueenAnticommie",
  "@badger69420",
  "piersmorgan",
  "AlexHormozi",
  "@gumvape",
  "@rachcorrine",
  "@SIGMAPROFESSOR",
  "@YourPrimePath",
  "@yxng_samyaa",
  "@heyzuesx",
  "@_Hybreed_"
];

const URGENT_BONUS = 1000; // massive score boost for urgent handles

/**
 * Top-priority handle — takes precedence over every other handle,
 * including other urgent handles. Always sorts first in the queue.
 * Always leave 2 responses to kemi_adeleke's posts
*/
export const TOP_PRIORITY_HANDLES: string[] = [
  "@realmfpriya",
  "@kemi_adeleke1",
  "@itssthyherinme",
  "@FitWithDrSam",
  "@JeremyTate41",
  "@SilkNHeels",
  "@Laineytales",
  "@PathOfMen_",
  // "@Laiiyylaa",
  "@ErikDavis",
  // "@miiagarro",
  "@Miranizimmm",
  "@niy2pretty",
  "@ceraliza",
  "@luv1bun",
  "@qoyyrazalq",
  "@cyberfeeIs"
];

const TOP_PRIORITY_BONUS = 1_000_000; // dwarfs URGENT_BONUS so this always ranks first

/**
 * Low-priority handles — tweets from these authors are never scored or
 * enqueued normally. main-interactive.ts defers their URLs to a Redis
 * cache instead and only pulls them back in once the real queue
 * (top-priority, urgent, everything else) is completely empty.
 */
export const LOW_PRIORITY_HANDLES: string[] = [
  //   "@brotherhood__33",
  // "@O1Txtx",
  // "@FablosJanny",
  // "@cyrilhustle",
  // "@Medally07",
  // "@EniolaFunmii",
  // "@Betty_homz",
  // "@otspiccy",
  // "@otuene_claude",
  // "@RiddleSphere",
  // "@theglobalZinny",
  // "@J_I_Khalifa",
  // "@Tallesty_",
  // "@Hakeem081",
  // "@ZTWzanku",
  // "@toxic_angeui",
  // "@HamidXBT",
  // "@NOT__RILEY",
  // "@maamblaq_trade",
  // "@KeruboSk",
  // "@Anietie_bassey1",
  // "@Fun_Trades1",
  // "@LEGACE_FX",
  // "@ArunaSegun26525",
  // "@classiceluwa",
  // "@Iam_Jay77",
  // "@Shasam_Fx",
  // "@Headsup01",
  // "@2skidcrypto",
  // "@Easyboy024",
  // "@raixdaily",
  // "@The_IQTrader",
  // "@kanishkaansh",
  // "@cyrilhustle",
  // "@CryptBella1",
  // "@bobbthetrader",
  // "@GTgiftie",
  // "@Bagchaser3310",
  // "@CharleyT60280",
  // "@D_Joshuas",
  // "@Trader_Ashman"
]

/**
 * Blocked handles — tweets from these authors are never scored, enqueued,
 * or replied to. They're skipped outright, taking precedence over every
 * other handle list (priority/urgent/top-priority included).
 */
export const BLOCKED_HANDLES: string[] = [
  "@Mario_Sneh",
  "lyleswontmiss",
  "@unfairleverage",
  "JusttJewell"
];

/**
 * Check if the author is a blocked handle.
 */
export function isBlockedHandle(author: string, username: string): boolean {
  const normalized = normalizeHandle(author);
  const normalizedUser = normalizeHandle(username);
  return BLOCKED_HANDLES.some(
    h => normalized === normalizeHandle(h) || normalizedUser === normalizeHandle(h)
  );
}

/**
 * Review handles — never auto-replied to, but not silently dropped like
 * BLOCKED_HANDLES either. Their posts get skipped and the URL logged to a
 * persistent, numbered list (storage/flaggedPosts.ts) so the operator can
 * go look at them by hand later, instead of Echo deciding on its own.
 */
export const REVIEW_HANDLES: string[] = [
  "@beemyli",
  "katyakayy"
];

/**
 * Check if the author is a review handle.
 */
export function isReviewHandle(author: string, username: string): boolean {
  const normalized = normalizeHandle(author);
  const normalizedUser = normalizeHandle(username);
  return REVIEW_HANDLES.some(
    h => normalized === normalizeHandle(h) || normalizedUser === normalizeHandle(h)
  );
}

/**
 * Check if the author is a low-priority handle.
 */
export function isLowPriority(author: string, username: string): boolean {
  const normalized = normalizeHandle(author);
  const normalizedUser = normalizeHandle(username);
  return LOW_PRIORITY_HANDLES.some(
    h => normalized === normalizeHandle(h) || normalizedUser === normalizeHandle(h)
  );
}

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
  const normalized = normalizeHandle(author);
  const normalizedUser = normalizeHandle(username);
  // Top-priority handles inherit all urgent-handle behavior (spam/age bypass)
  // in addition to outranking every other handle in score.
  if (isTopPriority(author, username)) return true;
  return URGENT_HANDLES.some(
    h => normalized === normalizeHandle(h) || normalizedUser === normalizeHandle(h)
  );
}

/**
 * Check if the author is a priority handle (PRIORITY_HANDLES).
 */
export function isPriority(author: string, username: string): boolean {
  const normalized = normalizeHandle(author);
  const normalizedUser = normalizeHandle(username);
  return PRIORITY_HANDLES.some(
    h => normalized === normalizeHandle(h) || normalizedUser === normalizeHandle(h)
  );
}

/**
 * Check if the author is a priority handle and return bonus.
 */
function priorityBonus(author: string, username: string): number {
  return isPriority(author, username) ? PRIORITY_BONUS : 0;
}

/**
 * Check if the author is an urgent handle and return the urgent bonus.
 */
function urgentBonus(author: string, username: string): number {
  return isUrgent(author, username) ? URGENT_BONUS : 0;
}

/**
 * Check if the author is the top-priority handle.
 */
export function isTopPriority(author: string, username: string): boolean {
  const normalized = normalizeHandle(author);
  const normalizedUser = normalizeHandle(username);
  return TOP_PRIORITY_HANDLES.some(
    h => normalized === normalizeHandle(h) || normalizedUser === normalizeHandle(h)
  );
}

/**
 * Check if the author is the top-priority handle and return its bonus.
 */
function topPriorityBonus(author: string, username: string): number {
  return isTopPriority(author, username) ? TOP_PRIORITY_BONUS : 0;
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
  const tpBonus = topPriorityBonus(tweet.author, tweet.username);

  // Weighted sum + priority bonus + urgent bonus + top-priority bonus
  const total =
    aScore  * 0.45 +
    rScore  * 0.30 +
    auScore * 0.10 +
    relScore * 0.05 +
    tScore  * 0.10 +
    pBonus +
    uBonus +
    tpBonus;

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
 *   - Replies > 50 → skip regardless of age (a reply that deep in a
 *     thread won't get seen, no matter how fresh the tweet still is)
 *   - Age > 12 hr → skip regardless of reply count
 *
 * Pulled out from shouldSkipDueToAgeAndReplies() so any caller that only
 * has the raw numbers (not a full TimelineTweet) — e.g. a tweet re-checked
 * right before opening it, after it's already been sitting in the queue or
 * the low-priority deferral cache for a while — can reuse the exact same
 * thresholds instead of a second, driftable copy of "50" and "720".
 */
export function isStaleByAgeAndReplies(replies: number, ageMinutes: number, bypassStaleCheck: boolean): boolean {
  if (bypassStaleCheck) return false;
  if (replies > 50) return true;
  if (ageMinutes > 720) return true; // > 12 hr → skip
  return false;
}

export function shouldSkipDueToAgeAndReplies(tweet: TimelineTweet): boolean {
  // Urgent handles (e.g. @WatcherGuru) are never skipped due to age/replies
  const bypass = isUrgent(tweet.author, tweet.username);

  const now = Date.now();
  const ageMs = now - tweet.createdAt.getTime();
  const ageMinutes = Math.max(0, ageMs / 60_000);

  return isStaleByAgeAndReplies(tweet.replies, ageMinutes, bypass);
}
