import readlineSync from "readline-sync";

export type Action =
    | "approve"
    | "edit"
    | "regenerate"
    | "skip"
    | "quit"
    | "reload";

export function readAction(): Action {
    while (true) {
        const key = readlineSync
            .question("\n[a]pprove [e]dit [r]egen [s]kip [l]oad [q]uit: ")
            .trim()
            .toLowerCase();

        switch (key) {
            case "a":
                return "approve";
            case "e":
                return "edit";
            case "r":
                return "regenerate";
            case "s":
                return "skip";
            case "l":
                return "reload";
            case "q":
                return "quit";
            default:
                console.log("Invalid option.");
        }
    }
}
