import { db } from "../database/db";

const DAILY_LIMIT = 40;

export function getReplyCountToday(): number {
  const today = new Date().toISOString().split("T")[0];
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM replies
    WHERE date(created_at / 1000, 'unixepoch') = ?
  `).get(today) as { count: number };
  
  return result.count;
}

export function canReplyToday(): boolean {
  return getReplyCountToday() < DAILY_LIMIT;
}

export function recordReply(tweetId: string, reply: string, success: boolean): void {
  db.prepare(`
    INSERT INTO replies (tweet_id, reply, success, created_at)
    VALUES (?, ?, ?, ?)
  `).run(tweetId, reply, success ? 1 : 0, Date.now());
}