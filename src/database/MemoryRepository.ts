import { prisma } from "./prisma";
import { ReplyMemory } from "../types/memory";

export class MemoryRepository {
  async hasMemory(tweetId: string): Promise<boolean> {
    const memory = await prisma.replyMemory.findFirst({
      where: { tweetId }
    });
    return !!memory;
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
    const memories = await prisma.replyMemory.findMany({
      where: { approved: true },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return memories.map((m: any) => ({
      id: m.id,
      tweetId: m.tweetId,
      tweetText: m.tweetText,
      author: m.author,
      relationship: m.relationship as any,
      aiDraft: m.aiDraft,
      finalReply: m.finalReply,
      wasEdited: m.wasEdited,
      approved: m.approved,
      createdAt: m.createdAt
    }));
  }
}