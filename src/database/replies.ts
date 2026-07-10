import { db } from "./db";

export function hasReplied(link: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM replies WHERE tweet_link=?"
    )
    .get(link);

  return !!row;
}

export function saveReply(
  link: string,
  author: string,
  tweet: string,
  reply: string
): void {
  db.prepare(
    `
INSERT INTO replies
(tweet_link, author, tweet, reply)
VALUES (?, ?, ?, ?)
`
  ).run(
    link,
    author,
    tweet,
    reply
  );
}