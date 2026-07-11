import prompts from "prompts";

export async function confirmPost(reply: string): Promise<boolean> {
    const confirm = await prompts({
        type: "confirm",
        name: "ok",
        message: "Post this reply?",
        initial: true
    });

    return confirm.ok;
}