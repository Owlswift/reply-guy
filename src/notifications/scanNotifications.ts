import { Page } from "playwright";
import { extractTweets } from "../browser/extractTweets";
import { scrollTimeline } from "../browser/scroll";
import { randomDelayMs } from "../behavior/delays";
import { TimelineTweet } from "../types/tweet";
import { log } from "../utils/logger";
import {
  wasReplyNotificationDiscovered,
  markReplyNotificationDiscovered,
} from "../storage/replyNotificationQueue";

/**
 * Scan the notifications feed for tweets that are replies addressed to
 * `echoHandle`, going no further back than `cutoffMs` (an absolute
 * Date.now()-based timestamp, e.g. Date.now() - 24h).
 *
 * Notifications render mostly-newest-first, so scanning stops early —
 * returning whatever qualifying replies were found so far — once either: a
 * notification older than the cutoff is encountered (everything after that
 * point is even older, and the caller asked to never look that far back),
 * or scanning runs into a streak of qualifying replies a previous scan
 * already recorded, with nothing new in between (see
 * replyNotificationQueue.ts). Each newly-discovered qualifying reply is
 * recorded as it's found, so this watermark advances from one run to the
 * next instead of rescanning the full lookback window every time.
 *
 * "Mostly" newest-first, not strictly: X bumps a thread's notification
 * back toward the top when there's continued activity on it — e.g. Echo
 * posting its own reply into that thread resurfaces the original commenter's
 * notification card on the very next load, ahead of genuinely newer replies
 * to other tweets that already scrolled further down. A single
 * already-known match is therefore treated as "might just be a resurfaced
 * one" and skipped rather than treated as proof everything past it is old
 * — only a run of REPEAT_THRESHOLD known matches in a row, with no new one
 * found in between, is trusted as "caught up."
 *
 * Reuses extractTweets(page, "notifications") — the same DOM extraction
 * already used elsewhere in this codebase for the notifications feed —
 * rather than a separate bespoke scraper. Its `replyingToHandle` field
 * (read from X's own "Replying to @X" line) is what identifies a
 * notification as a reply addressed to `echoHandle` versus a like, a
 * follow, an unrelated mention, or a reply to someone else.
 */
// How many already-known qualifying replies in a row (no new one found
// between them) it takes to trust that the scan has caught up to a
// previous run's watermark. 1 was too fragile in practice — a single
// resurfaced/bumped notification (see the module doc above) would
// immediately halt the scan before it ever reached genuinely new replies
// further down.
const REPEAT_THRESHOLD = 3;

export async function scanRecentReplyNotifications(
  page: Page,
  echoHandle: string,
  cutoffMs: number
): Promise<TimelineTweet[]> {
  const normalizedEcho = echoHandle.replace(/^@/, "").toLowerCase();
  const seenIds = new Set<string>();
  const qualifying: TimelineTweet[] = [];

  const maxScrolls = 20;
  let noNewCount = 0;
  let consecutiveKnownQualifying = 0;

  for (let i = 0; i < maxScrolls; i++) {
    const tweets = await extractTweets(page, "notifications");
    const fresh = tweets.filter((t) => !seenIds.has(t.id));

    if (fresh.length === 0) {
      noNewCount++;
      if (noNewCount >= 3) break;
    } else {
      noNewCount = 0;
    }

    let stopScanning = false;
    for (const t of fresh) {
      seenIds.add(t.id);

      if (t.createdAt.getTime() < cutoffMs) {
        log(`[Notifications] Reached the 24h cutoff at ${t.url} — stopping scan.`);
        stopScanning = true;
        break;
      }

      const replyingTo = (t.replyingToHandle ?? "").replace(/^@/, "").toLowerCase();
      if (!t.isReply || replyingTo !== normalizedEcho) continue;

      if (await wasReplyNotificationDiscovered(t.id)) {
        consecutiveKnownQualifying++;
        log(`[Notifications] Already-known reply at ${t.url} (${consecutiveKnownQualifying}/${REPEAT_THRESHOLD} in a row) — continuing to confirm.`);
        if (consecutiveKnownQualifying >= REPEAT_THRESHOLD) {
          log(`[Notifications] Confirmed caught up to a previous scan — stopping.`);
          stopScanning = true;
          break;
        }
        continue;
      }

      consecutiveKnownQualifying = 0;
      await markReplyNotificationDiscovered(t);
      qualifying.push(t);
    }

    if (stopScanning) break;

    await scrollTimeline(page);
    await page.waitForTimeout(randomDelayMs(500, 1000));
  }

  return qualifying;
}
