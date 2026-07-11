import { prisma } from "./prisma";
import { ReplyMemory } from "../types/memory";
import { Relationship } from "../relationship/types";

// Map TypeScript relationship to Prisma enum
function toPrismaRelationship(rel: Relationship): "STRANGER" | "FOLLOWING" | "MUTUAL" {
  const map: Record<Relationship, "STRANGER" | "FOLLOWING" | "MUTUAL"> = {
    stranger: "STRANGER",
    following: "FOLLOWING",
    verified: "STRANGER",
    mutual: "MUTUAL"
  };
  return map[rel];
}

// Map Prisma enum to TypeScript relationship
function fromPrismaRelationship(rel: "STRANGER" | "FOLLOWING" | "FOLLOWER" | "MUTUAL" | "SELF"): Relationship {
  if (rel === "FOLLOWING") return "following";
  if (rel === "MUTUAL") return "mutual";
  return "stranger";
}

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
        authorHandle: memory.authorHandle,
        relationship: toPrismaRelationship(memory.relationship),
        aiDraft: memory.aiDraft,
        editedReply: memory.editedReply || null,
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
      authorHandle: m.authorHandle,
      relationship: fromPrismaRelationship(m.relationship),
      aiDraft: m.aiDraft,
      editedReply: m.editedReply || undefined,
      finalReply: m.finalReply,
      wasEdited: m.wasEdited,
      approved: m.approved,
      createdAt: m.createdAt
    }));
  }
}