import express from "express";
import Database from "better-sqlite3";

const app = express();
const db = new Database("echo.db");

app.use(express.json());

// Get overview stats
app.get("/api/overview", (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  
  const replyCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM replies
    WHERE date(created_at / 1000, 'unixepoch') = ?
  `).get(today) as { count: number };
  
  const queueSize = db.prepare(`
    SELECT COUNT(*) as count
    FROM tweets
    WHERE status = 'pending'
  `).get() as { count: number };
  
  const errorCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM replies
    WHERE success = 0
  `).get() as { count: number };

  res.json({
    replyCount: replyCount.count,
    queueSize: queueSize.count,
    errorCount: errorCount.count,
    status: "running"
  });
});

// Get queue
app.get("/api/queue", (req, res) => {
  const queue = db.prepare(`
    SELECT *
    FROM tweets
    WHERE status = 'pending'
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
  
  res.json(queue);
});

// Get recent replies
app.get("/api/replies", (req, res) => {
  const replies = db.prepare(`
    SELECT *
    FROM replies
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
  
  res.json(replies);
});

// Get errors
app.get("/api/errors", (req, res) => {
  const errors = db.prepare(`
    SELECT *
    FROM replies
    WHERE success = 0
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
  
  res.json(errors);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Dashboard API running on http://localhost:${PORT}`);
});