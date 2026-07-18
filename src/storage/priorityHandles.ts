import Database from "better-sqlite3";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = new Database("echo.db");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS priority_handles (
    username TEXT PRIMARY KEY,
    last_seen_tweet_id TEXT,
    last_checked_at TEXT,
    check_interval_minutes INTEGER NOT NULL DEFAULT 60,
    created_at TEXT DEFAULT (datetime('now'))
);
`);

export interface PriorityHandleState {
  username: string;
  lastSeenTweetId: string | null;
  lastCheckedAt: Date | null;
  checkIntervalMinutes: number;
}

const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 12;
const MAX_INTERVAL_MINUTES = 240;

const insertIfMissingStmt = db.prepare(`
INSERT OR IGNORE INTO priority_handles (username, check_interval_minutes)
VALUES (?, ?)
`);

const selectStmt = db.prepare(`
SELECT username, last_seen_tweet_id, last_checked_at, check_interval_minutes
FROM priority_handles WHERE username = ?
`);

const selectAllStmt = db.prepare(`
SELECT username, last_seen_tweet_id, last_checked_at, check_interval_minutes
FROM priority_handles
`);

const updateAfterCheckStmt = db.prepare(`
UPDATE priority_handles
SET last_seen_tweet_id = ?, last_checked_at = ?, check_interval_minutes = ?
WHERE username = ?
`);

interface Row {
  username: string;
  last_seen_tweet_id: string | null;
  last_checked_at: string | null;
  check_interval_minutes: number;
}

function fromRow(row: Row): PriorityHandleState {
  return {
    username: row.username,
    lastSeenTweetId: row.last_seen_tweet_id,
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at) : null,
    checkIntervalMinutes: row.check_interval_minutes,
  };
}

/**
 * Make sure every handle we're supposed to be tracking has a row, so
 * getDueHandles() sees it (a handle with no row has never been checked and
 * is immediately due). Safe to call repeatedly — no-ops for existing rows.
 */
export function ensureTracked(usernames: string[]): void {
  for (const username of usernames) {
    insertIfMissingStmt.run(username.replace(/^@/, "").toLowerCase(), DEFAULT_INTERVAL_MINUTES);
  }
}

export function getHandleState(username: string): PriorityHandleState | undefined {
  const row = selectStmt.get(username.replace(/^@/, "").toLowerCase()) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

/**
 * Of the tracked handles, which ones are due for a check right now
 * (never checked, or past their own adaptive interval)?
 */
export function getDueHandles(usernames: string[]): PriorityHandleState[] {
  const rows = selectAllStmt.all() as Row[];
  const byUsername = new Map(rows.map(r => [r.username, fromRow(r)]));
  const now = Date.now();

  return usernames
    .map(u => u.replace(/^@/, "").toLowerCase())
    .map(u => byUsername.get(u))
    .filter((s): s is PriorityHandleState => {
      if (!s) return false;
      if (!s.lastCheckedAt) return true;
      const dueAt = s.lastCheckedAt.getTime() + s.checkIntervalMinutes * 60_000;
      return now >= dueAt;
    });
}

/**
 * Record the result of a check: how many new original posts we found, and
 * the newest tweet ID seen (so next time we know where to stop). The
 * interval adapts from the observed gap between originals — post often,
 * get checked more often; go quiet, get checked less often.
 */
export function recordCheck(
  username: string,
  newestTweetId: string | null,
  newOriginalsFound: number
): void {
  const key = username.replace(/^@/, "").toLowerCase();
  const existing = getHandleState(key);
  const previousInterval = existing?.checkIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES;

  let nextInterval = previousInterval;
  if (newOriginalsFound > 0 && existing?.lastCheckedAt) {
    const elapsedMinutes = (Date.now() - existing.lastCheckedAt.getTime()) / 60_000;
    // Estimated minutes between posts, given we saw N originals in this gap.
    const impliedGap = elapsedMinutes / newOriginalsFound;
    // Move the interval toward the implied posting gap rather than snapping
    // to it outright, so one unusually bursty check doesn't overcorrect.
    nextInterval = (previousInterval + impliedGap) / 2;
  } else if (newOriginalsFound === 0) {
    // Nothing new — back off gradually.
    nextInterval = previousInterval * 1.25;
  }
  nextInterval = Math.max(MIN_INTERVAL_MINUTES, Math.min(MAX_INTERVAL_MINUTES, Math.round(nextInterval)));

  updateAfterCheckStmt.run(
    newestTweetId ?? existing?.lastSeenTweetId ?? null,
    new Date().toISOString(),
    nextInterval,
    key
  );
}
