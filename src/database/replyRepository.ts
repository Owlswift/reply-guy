import { db } from "./db";

export interface Reply {
  id?: number;
  tweet_id: string;
  draft: string;
  final_reply: string;
  status: string;
  created_at: string;
}

export function saveReply(reply: Reply): void {
  db.prepare(`
    INSERT INTO replies (tweet_id, draft, final_reply, status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(reply.tweet_id, reply.draft, reply.final_reply, reply.status, reply.created_at);
}

export function getReplyCountToday(): number {
  const today = new Date().toISOString().split("T")[0];
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM replies
    WHERE date(created_at / 1000, 'unixepoch') = ?
  `).get(today) as { count: number };
  return result.count;
}

export function getRecentReplies(limit = 20): Reply[] {
  return db.prepare(`
    SELECT * FROM replies
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Reply[];
}