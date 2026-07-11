import { ReplyMemory } from "../types/memory";

export function formatMemories(memories: ReplyMemory[]): string {
    if (!memories || memories.length === 0) return "";
    
    // Limit to 5 memories to keep prompt concise
    const limited = memories.slice(0, 5);
    
    return limited.map((m, i) => `
Example ${i + 1}
----------------------------------
Original Tweet:
${m.tweetText}

John replied:
${m.finalReply}
`).join("\n");
}