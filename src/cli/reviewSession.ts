import { Page } from "playwright";
import { generateReply } from "../ai/ollama";
import { buildPrompt } from "../ai/buildPrompt";
import { prepareReply, getBrowserReply, clickReply } from "../reply/reply";
import { reviewReply } from "./promptReply";
import { chooseReplySource } from "./conflictPrompt";
import { confirmPost } from "./confirm";
import { DraftRepository } from "../database/DraftRepository";
import { Relationship } from "../relationship/types";

const draftRepo = new DraftRepository();

export interface ReviewSessionResult {
    status: "posted" | "skipped" | "cancelled";
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
    // Load recent memories for learning
    const memories = await draftRepo.getRecentMemories(20);
    
    const prompt = buildPrompt({
        tweet: details.text,
        relationship: details.relationship,
        memories
    });

    // Use existing draft if available, otherwise generate
    let draft = details.existingDraft ?? await generateReply(prompt);
    let terminalReply = draft;

    // Fill browser with initial draft
    await prepareReply(page, terminalReply);

    while (true) {
        const review = await reviewReply(
            details.author,
            details.text,
            terminalReply
        );

        switch (review.action) {
            case "edit":
                terminalReply = review.reply;
                await prepareReply(page, terminalReply);
                continue;

            case "regenerate":
                draft = await generateReply(prompt);
                terminalReply = draft;
                await prepareReply(page, terminalReply);
                continue;

            case "skip":
                return { status: "skipped" };

            case "quit":
                process.exit(0);

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

    // Compare browser vs terminal
    const browserReply = await getBrowserReply(page);
    let finalReply = terminalReply;

    if (browserReply.trim() !== terminalReply.trim()) {
        // Different - ask which to use
        const source = await chooseReplySource(terminalReply, browserReply);

        if (source === "cancel") {
            return { status: "cancelled" };
        }

        if (source === "browser") {
            finalReply = browserReply;
        } else {
            // Use terminal - overwrite browser
            await prepareReply(page, terminalReply);
        }
    }

    // Final confirmation
    const confirmed = await confirmPost(finalReply);
    if (!confirmed) {
        return { status: "cancelled" };
    }

    // Submit
    const success = await clickReply(page, details.author);

    if (success) {
        return {
            status: "posted",
            draft,
            finalReply
        };
    }

    return { status: "cancelled" };
}