import Database from "better-sqlite3";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: any = new Database("echo.db");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS seen_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id TEXT UNIQUE,
    tweet_url TEXT,
    replied INTEGER NOT NULL DEFAULT 0,
    seen_at TEXT DEFAULT (datetime('now'))
);
`);

const insertStmt = db.prepare(`
INSERT OR IGNORE INTO seen_notifications (tweet_id, tweet_url)
VALUES (?, ?)
`);

const selectStmt = db.prepare(`
SELECT 1 FROM seen_notifications WHERE tweet_id = ?
`);

const selectRepliedStmt = db.prepare(`
SELECT replied FROM seen_notifications WHERE tweet_id = ?
`);

const markRepliedStmt = db.prepare(`
UPDATE seen_notifications SET replied = 1 WHERE tweet_id = ?
`);

const countTotalStmt = db.prepare(`
SELECT COUNT(*) as total FROM seen_notifications
`);

const countRepliedStmt = db.prepare(`
SELECT COUNT(*) as total FROM seen_notifications WHERE replied = 1
`);

export function markNotificationSeen(tweetId: string, tweetUrl: string): void {
  insertStmt.run(tweetId, tweetUrl);
}

export function isNotificationSeen(tweetId: string): boolean {
  const row = selectStmt.get(tweetId);
  return !!row;
}

export function hasNotificationReplied(tweetId: string): boolean {
  const row = selectRepliedStmt.get(tweetId);
  return row ? row.replied === 1 : false;
}

export function markNotificationReplied(tweetId: string): void {
  markRepliedStmt.run(tweetId);
}

export function getNotificationProgress(): { total: number; replied: number } {
  const totalRow = countTotalStmt.get() as { total: number };
  const repliedRow = countRepliedStmt.get() as { total: number };
  return {
    total: totalRow.total,
    replied: repliedRow.total,
  };
}