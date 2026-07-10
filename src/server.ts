import express from "express";
import dotenv from "dotenv";

import { config } from "./config";
import { prisma } from "./database/prisma";

dotenv.config();

const app = express();

app.use(express.json());

app.get("/", (_, res) => {
  res.json({
    status: "Echo is running 🚀",
  });
});

/**
 * Fetch new tweets from the active source and store them in the database.
 * This is the ingestion endpoint — the start of the pipeline.
 */
app.post("/ingest", async (_, res) => {
  try {
    const source = config.tweetSource();
    const tweets = await source.getNewTweets();

    for (const tweet of tweets) {
      await prisma.tweet.upsert({
        where: { tweetId: tweet.tweetId },
        update: {},
        create: {
          tweetId: tweet.tweetId,
          authorId: tweet.authorId,
          authorHandle: tweet.authorHandle,
          text: tweet.text,
          conversationId: tweet.conversationId,
          createdAtX: tweet.createdAtX,
        },
      });
    }

    res.json({
      ingested: tweets.length,
      tweets: tweets.map((t) => ({
        id: t.tweetId,
        author: t.authorHandle,
        text: t.text.slice(0, 80) + (t.text.length > 80 ? "..." : ""),
      })),
    });
  } catch (error) {
    console.error("Ingestion failed:", error);
    res.status(500).json({ error: "Failed to ingest tweets" });
  }
});

/**
 * List all tweets in the database with their status.
 */
app.get("/tweets", async (_, res) => {
  const tweets = await prisma.tweet.findMany({
    include: { draft: true },
    orderBy: { createdAt: "desc" },
  });

  res.json({ tweets });
});

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});