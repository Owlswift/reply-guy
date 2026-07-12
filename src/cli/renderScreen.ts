import chalk from "chalk";
import { stats, getRuntime } from "../stats/runtime";

export function renderScreen(
    author: string,
    tweet: string,
    reply: string,
    attempt: number = 1
) {
    console.clear();

    // Stats header
    console.log(
        chalk.cyan.bold("══════════════════════════════════════════════")
    );
    console.log(
        chalk.gray(`Tweets Seen: ${stats.tweets}  |  `) +
        chalk.green(`Posted: ${stats.posted}  |  `) +
        chalk.yellow(`Skipped: ${stats.skipped}  |  `) +
        chalk.blue(`Regenerated: ${stats.regenerated}  |  `) +
        chalk.magenta(`Runtime: ${getRuntime()}`)
    );
    console.log(
        chalk.cyan.bold("══════════════════════════════════════════════\n")
    );

    console.log(chalk.yellow(`👤 ${author}\n`));

    console.log(chalk.white(tweet));

    console.log(
        chalk.gray("\n──────────────────────────────────────────────\n")
    );

    console.log(chalk.green(`AI Generation #${attempt}\n`));

    console.log(reply);

    console.log(
        chalk.cyan.bold("\n══════════════════════════════════════════════\n")
    );
}

export function renderCandidates(
    author: string,
    tweet: string,
    candidates: string[]
) {
    console.clear();

    // Stats header
    console.log(
        chalk.cyan.bold("══════════════════════════════════════════════")
    );
    console.log(
        chalk.gray(`Tweets Seen: ${stats.tweets}  |  `) +
        chalk.green(`Posted: ${stats.posted}  |  `) +
        chalk.yellow(`Skipped: ${stats.skipped}  |  `) +
        chalk.blue(`Regenerated: ${stats.regenerated}  |  `) +
        chalk.magenta(`Runtime: ${getRuntime()}`)
    );
    console.log(
        chalk.cyan.bold("══════════════════════════════════════════════\n")
    );

    console.log(chalk.yellow(`👤 ${author}\n`));

    console.log(chalk.white(tweet));

    console.log(
        chalk.gray("\n──────────────────────────────────────────────\n")
    );

    for (let i = 0; i < candidates.length; i++) {
        const label = i === 0 ? "A" : i === 1 ? "B" : "C";
        console.log(chalk.green(`Option ${label}:\n`));
        console.log(candidates[i]);
        if (i < candidates.length - 1) {
            console.log(chalk.gray("\n──────────────────────────────────────────────\n"));
        }
    }

    console.log(
        chalk.cyan.bold("\n══════════════════════════════════════════════\n")
    );
}