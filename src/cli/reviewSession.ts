import { Page } from "playwright";
import { generateReply } from "../ai/ollama";
import { buildPrompt } from "../ai/buildPrompt";
import { prepareReply, clickReply } from "../reply/reply";
import { reviewReply } from "./promptReply";
import { chooseReplySource } from "./conflictPrompt";
import { confirmPost } from "./confirm";
import { MemoryRepository } from "../database/MemoryRepository";
import { Relationship } from "../relationship/types";
import { sessionManager } from "../core/sessionManager";
import { navigateToHome } from "../browser/timeline";

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
    details: ReviewSessionDetails
): Promise<ReviewSessionResult> {
    // Enter REVIEWING state - this blocks all other workers
    sessionManager.startReview(details.id);
    
    try {
        // Load recent memories for learning
        const memories = await memoryRepo.getRecentMemories(20);
        
        const prompt = buildPrompt({
            tweet: details.text,
            relationship: details.relationship,
            memories
        });

        // Use existing draft if available, otherwise generate
        let draft = details.existingDraft ?? await generateReply(prompt);
        let terminalReply = draft;

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
                draft = await generateReply(prompt);
                terminalReply = draft;
                // Return regen status to signal browser worker to put back in queue
                return { status: "regen", draft };

            case "skip":
                return { status: "skipped" };

            case "quit":
                process.exit(0);

            case "reload":
                // Navigate to home page to reset state
                console.log("Reloading to home page...");
                await navigateToHome(page);
                return { status: "cancelled" };

            case "approve":
                break;
        }

            break;
        }

        // Check for empty reply
        if (!terminalReply.trim()) {
            console.log("Reply cannot be empty.");
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

        // Navigate back to timeline (only if not in dry run mode)
        if (!process.env.DRY_RUN) {
            await page.waitForTimeout(2000);
            try {
                // Try goBack first, but fall back to navigateToHome if stuck
                await page.goBack({ timeout: 5000 });
                await page.waitForLoadState("networkidle", { timeout: 10000 });
            } catch (err) {
                console.log("goBack failed, navigating to home...");
                await navigateToHome(page);
            }
            await page.waitForTimeout(1000);
        }

        if (success) {
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