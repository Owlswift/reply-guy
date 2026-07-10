import Database from "better-sqlite3";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const database: any = new Database("echo.db");

database.pragma("journal_mode = WAL");

database.exec(`
CREATE TABLE IF NOT EXISTS tweets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id TEXT UNIQUE,
    author TEXT,
    text TEXT,
    url TEXT,
    scraped_at TEXT
);
`);

database.exec(`
CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,
    tweet_id TEXT,
    draft TEXT,
    final_reply TEXT,
    status TEXT,
    created_at TEXT
);
`);

database.exec(`
CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT UNIQUE,
    tweet_id TEXT,
    priority INTEGER DEFAULT 0,
    status TEXT,
    retries INTEGER DEFAULT 0,
    created_at TEXT
);
`);

database.exec(`
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT,
    message TEXT,
    created_at TEXT
);
`);

export { database as db };
