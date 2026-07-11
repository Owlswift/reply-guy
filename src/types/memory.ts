import { Relationship } from "../relationship/types";

export interface ReplyMemory {
    id: string;
    tweetId: string;
    tweetText: string;
    authorHandle: string;
    relationship: Relationship;
    aiDraft: string;
    editedReply?: string;
    finalReply: string;
    wasEdited: boolean;
    approved: boolean;
    createdAt: Date;
}