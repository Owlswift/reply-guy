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
import { navigateToHomeAfterPost } from "../reply/submitReply";

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
    console.log(`[ReviewSession] Starting review for tweet ${details.id}`);
    
    // Enter REVIEWING state - this blocks all other workers
    sessionManager.startReview(details.id);
    
    try {
        // Load recent memories for learning
        console.log("[ReviewSession] Loading memories...");
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
                console.log("[ReviewSession] User editing reply...");
                terminalReply = review.reply;
                continue;

            case "regenerate":
                console.log("[ReviewSession] User regenerating reply...");
                draft = await generateReply(prompt);
                terminalReply = draft;
                // Return regen status to signal browser worker to put back in queue
                return { status: "regen", draft };

            case "skip":
                console.log("[ReviewSession] User skipping tweet...");
                return { status: "skipped" };

            case "quit":
                console.log("[ReviewSession] User quitting...");
                process.exit(0);

            case "reload":
                // Navigate to home page to reset state
                console.log("[ReviewSession] User reloading to home page...");
                await navigateToHome(page);
                return { status: "cancelled" };

            case "approve":
                console.log("[ReviewSession] User approved reply...");
                break;
        }

            break;
        }

        // Check for empty reply
        if (!terminalReply.trim()) {
            console.log("[ReviewSession] Reply is empty, cancelling...");
            return { status: "cancelled" };
        }

        // Final confirmation
        console.log("[ReviewSession] Asking for final confirmation...");
        const confirmed = await confirmPost(terminalReply);
        if (!confirmed) {
            console.log("[ReviewSession] User cancelled post...");
            return { status: "cancelled" };
        }

        // Switch to POSTING state for the actual post operation
        console.log("[ReviewSession] Starting post operation...");
        sessionManager.startPosting();

        // NOW open the reply box and post (prepareReply already calls openReplyBox)
        console.log("[ReviewSession] Opening reply box and preparing reply...");
        await prepareReply(page, terminalReply);

        // Submit
        console.log("[ReviewSession] Clicking reply button...");
        const success = await clickReply(page, details.author);

        // Navigate back to timeline (only if not in dry run mode)
        if (!process.env.DRY_RUN) {
            console.log("[ReviewSession] Waiting 2s after post...");
            await page.waitForTimeout(2000);
            // Navigate to home to ensure we're back on timeline
            console.log("[ReviewSession] Navigating to home after post...");
            await navigateToHomeAfterPost(page);
            console.log("[ReviewSession] Waiting 1s after navigation...");
            await page.waitForTimeout(1000);
        }

        if (success) {
            console.log("[ReviewSession] Post successful!");
            return {
                status: "posted",
                draft,
                finalReply: terminalReply
            };
        }

        console.log("[ReviewSession] Post failed, returning cancelled...");
        return { status: "cancelled" };
    } finally {
        // Always exit REVIEWING state, even on error
        console.log("[ReviewSession] Ending review session...");
        sessionManager.endReview();
    }
}