import prompts from "prompts";
import chalk from "chalk";

export async function chooseReplySource(
    terminalReply: string,
    browserReply: string
): Promise<"terminal" | "browser" | "cancel"> {
    console.log("\n==========================================");
    console.log("Terminal");
    console.log("------------------------------------------");
    console.log(terminalReply);
    console.log("==========================================");
    console.log("Browser");
    console.log("------------------------------------------");
    console.log(browserReply);
    console.log("==========================================\n");

    const { source } = await prompts({
        type: "select",
        name: "source",
        message: "Reply changed in browser",
        choices: [
            {
                title: "Use Terminal version",
                value: "terminal"
            },
            {
                title: "Use Browser version",
                value: "browser"
            },
            {
                title: "Cancel",
                value: "cancel"
            }
        ]
    });

    return source;
}