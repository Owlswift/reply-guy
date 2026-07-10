import { db } from "./db";

export interface Tweet {
  id?: number;
  tweet_id: string;
  author: string;
  text: string;
  url: string;
  scraped_at: string;
}

export function saveTweet(tweet: Tweet): void {
  db.prepare(`
    INSERT OR IGNORE INTO tweets (tweet_id, author, text, url, scraped_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tweet.tweet_id, tweet.author, tweet.text, tweet.url, tweet.scraped_at);
}

export function getTweet(tweetId: string): Tweet | undefined {
  return db.prepare(`
    SELECT * FROM tweets WHERE tweet_id = ?
  `).get(tweetId) as Tweet | undefined;
}

export function hasTweet(tweetId: string): boolean {
  const result = db.prepare(`
    SELECT 1 FROM tweets WHERE tweet_id = ?
  `).get(tweetId);
  return !!result;
}