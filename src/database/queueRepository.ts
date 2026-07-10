import { db } from "./db";
import { randomUUID } from "crypto";

export interface QueueItem {
  id?: number;
  task_id: string;
  tweet_id: string;
  priority: number;
  status: string;
  retries: number;
  created_at: string;
}

export function enqueue(tweetId: string, priority = 0): string {
  const taskId = randomUUID();
  db.prepare(`
    INSERT INTO queue (task_id, tweet_id, priority, status, retries, created_at)
    VALUES (?, ?, ?, 'pending', 0, ?)
  `).run(taskId, tweetId, priority, Date.now().toString());
  return taskId;
}

export function dequeue(): QueueItem | undefined {
  const item = db.prepare(`
    SELECT * FROM queue
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get() as QueueItem | undefined;
  
  if (item) {
    db.prepare(`DELETE FROM queue WHERE id = ?`).run(item.id);
  }
  
  return item;
}

export function getQueueSize(): number {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM queue WHERE status = 'pending'
  `).get() as { count: number };
  return result.count;
}

export function updateQueueStatus(taskId: string, status: string, retries?: number): void {
  if (retries !== undefined) {
    db.prepare(`UPDATE queue SET status = ?, retries = ? WHERE task_id = ?`)
      .run(status, retries, taskId);
  } else {
    db.prepare(`UPDATE queue SET status = ? WHERE task_id = ?`).run(status, taskId);
  }
}