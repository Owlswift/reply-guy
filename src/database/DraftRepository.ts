import { prisma } from "./prisma";

export class DraftRepository {
  async saveDecision(
    xTweetId: string,
    reply: string,
    approved: boolean
  ) {
    // First, find or create the Tweet record
    const tweet = await prisma.tweet.upsert({
      where: {
        tweetId: xTweetId,
      },
      update: {},
      create: {
        tweetId: xTweetId,
        authorId: "unknown",
        authorHandle: "unknown",
        text: "Unknown tweet",
      },
    });

    // Then upsert the draft
    return prisma.draft.upsert({
      where: {
        tweetId: tweet.id,
      },
      update: {
        reply,
        approved,
      },
      create: {
        tweetId: tweet.id,
        reply,
        confidence: 95,
        reason: "Pending",
        approved,
      },
    });
  }
}