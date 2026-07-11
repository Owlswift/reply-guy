import { prisma } from "./prisma";
import { ReplyMemory } from "../types/memory";

export class MemoryRepository {
  async hasMemory(tweetId: string): Promise<boolean> {
    const memory = await prisma.replyMemory.findUnique({
      where: { tweetId }
    });
    return memory !== null;
  }

  async saveMemory(memory: ReplyMemory) {
    return prisma.replyMemory.create({
      data: {
        tweetId: memory.tweetId,
        tweetText: memory.tweetText,
        author: memory.author,
        relationship: memory.relationship,
        aiDraft: memory.aiDraft,
        finalReply: memory.finalReply,
        wasEdited: memory.wasEdited,
        approved: memory.approved,
        createdAt: memory.createdAt,
      }
    });
  }

  async getRecentMemories(limit: number = 20): Promise<ReplyMemory[]> {
    return prisma.replyMemory.findMany({
      where: { approved: true },
      orderBy: { createdAt: 'desc' },
      take: limit
    }) as Promise<ReplyMemory[]>;
  }
}