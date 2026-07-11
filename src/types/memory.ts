import { Relationship } from "../relationship/types";

export interface ReplyMemory {
    id: string;
    tweetId: string;
    tweetText: string;
    author: string;
    relationship: Relationship;
    aiDraft: string;
    finalReply: string;
    approved: boolean;
    createdAt: Date;
}