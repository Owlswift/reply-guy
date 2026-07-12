import { Page } from "playwright";
import { generateReply } from "../ai/ollama";
import { classifyTweet, TweetType } from "../ai/classifyTweet";
import { prepareReply, clickReply } from "../reply/reply";
import { reviewReply } from "./promptReply";
import { chooseReplySource } from "./conflictPrompt";
import { confirmPost } from "./confirm";
import { MemoryRepository } from "../database/MemoryRepository";
import { Relationship } from "../relationship/types";
import { sessionManager } from "../core/sessionManager";
import { BrowserNavigator } from "../browser/BrowserNavigator";

const memoryRepo = new MemoryRepository();

export interface ReviewSessionResult {
    status: "posted" | "skipped" | "cancelled" | "regen";
    draft?: string;
    finalReply?: string;
}

export interface ReviewSessionDetails {
    id: string;
    author: string;
    text: string;
    relationship: Relationship;
    existingDraft: string | undefined;
}

export async function reviewSession(
    page: Page,
    navigator: BrowserNavigator,
    details: ReviewSessionDetails
): Promise<ReviewSessionResult> {
    // Enter REVIEWING state - this blocks all other workers
    sessionManager.startReview(details.id);
    
    try {
        // Load recent memories for learning
        const memories = await memoryRepo.getRecentMemories(20);
        console.log(`🧠 Loaded ${memories.length} past replies for learning (${memories.filter(m => m.wasEdited).length} were edited by you)\n`);
        
        // Classify the tweet to decide how to handle it
        const tweetType: TweetType = classifyTweet(details.text);

        // Use existing draft if available, otherwise generate
        let draft = details.existingDraft ?? await generateReply({
            tweet: details.text,
            relationship: details.relationship,
            memories
        });
        let terminalReply = draft;

        // Auto-approve well-wish tweets (happy sunday, happy new week, etc.) — no intervention needed
        if (tweetType === "well_wish") {
            console.log(`🤖 Auto-replying to well-wish tweet from @${details.author}\n`);
            
            // Switch to POSTING state for the actual post operation
            sessionManager.startPosting();

            // Open reply box and post
            await prepareReply(page, terminalReply);
            const success = await clickReply(page, details.author);

            if (!process.env.DRY_RUN) {
                await page.waitForTimeout(2000);
                await navigator.returnToTimeline();
            }

            if (success) {
                try {
                    const memory: any = {
                        id: "",
                        tweetId: details.id,
                        tweetText: details.text,
                        authorHandle: details.author,
                        relationship: details.relationship,
                        aiDraft: draft,
                        finalReply: terminalReply,
                        wasEdited: false,
                        approved: true,
                        createdAt: new Date()
                    };
                    await memoryRepo.saveMemory(memory);
                    console.log("🧠 Saved reply to memory for learning.\n");
                } catch (err) {
                    console.error("Failed to save memory:", err);
                }
            }

            return {
                status: "posted",
                draft,
                finalReply: terminalReply
            };
        }

        // First, review in terminal WITHOUT opening reply box
        while (true) {
            const review = await reviewReply(
                details.author,
                details.text,
                terminalReply
            );

        switch (review.action) {
            case "edit":
                terminalReply = review.reply;
                continue;

            case "regenerate":
                draft = await generateReply({
                    tweet: details.text,
                    relationship: details.relationship,
                    memories
                });
                terminalReply = draft;
                // Return regen status to signal browser worker to put back in queue
                return { status: "regen", draft };

            case "skip":
                return { status: "skipped" };

            case "quit":
                process.exit(0);

            case "reload":
                // Navigate to i/timeline to reset state
                await navigator.navigateToTimeline();
                return { status: "cancelled" };

            case "approve":
                break;
        }

            break;
        }

        // Check for empty reply
        if (!terminalReply.trim()) {
            return { status: "cancelled" };
        }

        // Final confirmation
        const confirmed = await confirmPost(terminalReply);
        if (!confirmed) {
            return { status: "cancelled" };
        }

        // Switch to POSTING state for the actual post operation
        sessionManager.startPosting();

        // NOW open the reply box and post (prepareReply already calls openReplyBox)
        await prepareReply(page, terminalReply);

        // Submit
        const success = await clickReply(page, details.author);

        // Navigate back to i/timeline (only if not in dry run mode)
        if (!process.env.DRY_RUN) {
            await page.waitForTimeout(2000);
            await navigator.returnToTimeline();
        }

        if (success) {
            // Save this reply as a memory so the AI learns from it
            try {
                const wasEdited = draft !== terminalReply;
                const memory: any = {
                    id: "",
                    tweetId: details.id,
                    tweetText: details.text,
                    authorHandle: details.author,
                    relationship: details.relationship,
                    aiDraft: draft,
                    finalReply: terminalReply,
                    wasEdited,
                    approved: true,
                    createdAt: new Date()
                };
                if (wasEdited) {
                    memory.editedReply = terminalReply;
                }
                await memoryRepo.saveMemory(memory);
                console.log("🧠 Saved reply to memory for learning.\n");
            } catch (err) {
                console.error("Failed to save memory:", err);
            }

            return {
                status: "posted",
                draft,
                finalReply: terminalReply
            };
        }

        return { status: "cancelled" };
    } finally {
        // Always exit REVIEWING state, even on error
        sessionManager.endReview();
    }
}