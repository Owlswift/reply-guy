import { classifyTweet } from "./classifyTweet";
import { analyzeTweet, TweetAnalysis } from "./analyzeTweet";
import { Relationship } from "../relationship/types";
import { buildPersonalityPrompt } from "../personality/prompt";
import { ReplyMemory } from "../types/memory";

export interface PromptInput {
    tweet: string;
    relationship: Relationship;
    memories: ReplyMemory[];
    imageDescriptions?: string[] | undefined;
}

export interface PromptResult {
    prompt: string;
    category: string;
    analysis: TweetAnalysis | null;
}

export async function buildPrompt(input: PromptInput): Promise<PromptResult> {
    // Step 1: Keyword-based classification (fast, no model call)
    const category = classifyTweet(input.tweet);

    // Step 2: For non-trivial types, get deeper analysis from the model
    let analysis: TweetAnalysis | undefined;
    if (category !== "well_wish" && category !== "greeting") {
        try {
            analysis = await analyzeTweet(input.tweet, category);
        } catch {
            // Model analysis is optional — fall back to keyword-only
        }
    }

    // Step 3: Build the prompt using category + analysis
    const prompt = buildPersonalityPrompt(
        input.tweet,
        input.relationship,
        category,
        input.memories,
        input.imageDescriptions,
        analysis
    );

    return { prompt, category, analysis: analysis ?? null };
}