import prompts from "prompts";

export async function confirmPost(message: string): Promise<boolean> {
    const confirm = await prompts({
        type: "confirm",
        name: "ok",
        message,
        initial: true
    });

    return confirm.ok;
}
