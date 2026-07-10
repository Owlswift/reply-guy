import { db } from "./db";

export interface Log {
  id?: number;
  level: string;
  message: string;
  created_at: string;
}

export function log(level: string, message: string): void {
  db.prepare(`
    INSERT INTO logs (level, message, created_at)
    VALUES (?, ?, ?)
  `).run(level, message, Date.now().toString());
}

export function getLogs(limit = 100): Log[] {
  return db.prepare(`
    SELECT * FROM logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Log[];
}

export function getErrorCount(): number {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM logs WHERE level = 'error'
  `).get() as { count: number };
  return result.count;
}