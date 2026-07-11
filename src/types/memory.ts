import { Relationship } from "../relationship/types";

export interface ReplyMemory {
    id: string;
    tweetId: string;
    tweetText: string;
    author: string;
    relationship: Relationship;
    aiDraft: string;
    finalReply: string;
    wasEdited: boolean;
    approved: boolean;
    createdAt: Date;
}