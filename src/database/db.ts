import Database from "better-sqlite3";

export const db = new Database("echo.db");

db.exec(`
CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_link TEXT UNIQUE,
    author TEXT,
    tweet TEXT,
    reply TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);