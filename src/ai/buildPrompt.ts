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
    const keywordCategory = classifyTweet(input.tweet);

    // Step 2: For non-trivial types, get deeper analysis from the model
    let analysis: TweetAnalysis | undefined;
    if (keywordCategory !== "well_wish" && keywordCategory !== "greeting") {
        try {
            analysis = await analyzeTweet(input.tweet);
        } catch {
            // Model analysis is optional — fall back to keyword-only
        }
    }

    // The keyword classifier is shallow — a single incidental word (e.g.
    // "job"/"interview" inside a multi-paragraph workplace anecdote) can
    // misfile an actual story as "career" and skip every story-specific
    // rule (like never ending a reply with a question), even though the
    // tweet is clearly a narrative once you actually read it. The
    // model's own classification understands structure, not just
    // keywords, so prefer it once it's available.
    const category = analysis?.type ?? keywordCategory;

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