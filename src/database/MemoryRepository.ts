import { prisma } from "./prisma";
import { ReplyMemory } from "../types/memory";

export class MemoryRepository {
  async hasDecision(xTweetId: string): Promise<boolean> {
    const tweet = await prisma.tweet.findUnique({
      where: { tweetId: xTweetId }
    });
    if (!tweet) return false;
    
    const draft = await prisma.draft.findUnique({
      where: { tweetId: tweet.id }
    });
    return !!draft;
  }

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

  async saveMemory(memory: ReplyMemory) {
    return prisma.memory.create({
      data: {
        tweetId: memory.tweetId,
        tweetText: memory.tweetText,
        author: memory.author,
        relationship: memory.relationship,
        aiDraft: memory.aiDraft,
        finalReply: memory.finalReply,
        approved: memory.approved,
        createdAt: memory.createdAt,
      }
    });
  }

  async getRecentMemories(limit: number = 20): Promise<ReplyMemory[]> {
    const memories = await prisma.memory.findMany({
      where: { approved: true },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return memories.map(m => ({
      id: m.id,
      tweetId: m.tweetId,
      tweetText: m.tweetText,
      author: m.author,
      relationship: m.relationship as any,
      aiDraft: m.aiDraft,
      finalReply: m.finalReply,
      approved: m.approved,
      createdAt: m.createdAt
    }));
  }
}