import { renderScreen } from "./renderScreen";
import { readAction } from "./readKey";
import { confirmPost } from "./confirm";
import readlineSync from "readline-sync";

export { confirmPost };

export interface ReviewResult {
    action:
        | "approve"
        | "edit"
        | "regenerate"
        | "skip"
        | "quit"
        | "reload";
    reply: string;
}

export async function reviewReply(
    author: string,
    tweet: string,
    draft: string,
    attempt: number = 1
): Promise<ReviewResult> {
    renderScreen(author, tweet, draft, attempt);

    const action = readAction();

    if (action === "approve") {
        return { action: "approve", reply: draft };
    }
    
    if (action === "edit") {
        const edited = readlineSync.question(
            "\nEdit reply:\n",
            {
                defaultInput: draft
            }
        );

        // If empty, keep original
        const reply = edited.trim() || draft;
        
        return { action: "edit", reply };
    }
    
    if (action === "regenerate") {
        return { action: "regenerate", reply: draft };
    }
    
    if (action === "skip") {
        return { action: "skip", reply: draft };
    }
    
    if (action === "quit") {
        process.exit(0);
    }

    if (action === "reload") {
        return { action: "reload", reply: draft };
    }

    return { action: "skip", reply: draft };
}
