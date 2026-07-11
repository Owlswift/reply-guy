import { classifyTweet } from "./classifyTweet";
import { Relationship } from "../relationship/types";
import { buildPersonalityPrompt } from "../personality/prompt";
import { ReplyMemory } from "../types/memory";

export interface BuildPromptOptions {
    tweet: string;
    relationship: Relationship;
    memories?: ReplyMemory[];
}

export function buildPrompt(options: BuildPromptOptions | string, relationship: Relationship = "stranger", memories?: ReplyMemory[]): string {
    // Support both old and new API
    const tweet = typeof options === "string" ? options : options.tweet;
    const rel = typeof options === "string" ? relationship : options.relationship;
    const mems = typeof options === "string" ? memories : options.memories;
    
    const type = classifyTweet(tweet);
    return buildPersonalityPrompt(tweet, rel, type, mems);
}