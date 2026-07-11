import { classifyTweet } from "./classifyTweet";
import { Relationship } from "../relationship/types";
import { buildPersonalityPrompt } from "../personality/prompt";
import { ReplyMemory } from "../types/memory";

export interface PromptInput {
    tweet: string;
    relationship: Relationship;
    memories: ReplyMemory[];
}

export function buildPrompt(input: PromptInput): string {
    const type = classifyTweet(input.tweet);
    return buildPersonalityPrompt(input.tweet, input.relationship, type, input.memories);
}