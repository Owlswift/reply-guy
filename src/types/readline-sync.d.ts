declare module "readline-sync" {
    export function question(query: string, options?: {
        defaultInput?: string;
        hideEchoBack?: boolean;
        hideEchoBackIfEmpty?: boolean;
        trueValue?: string[];
        falseValue?: string[];
    }): string;
    
    export function keyIn(query: string, options?: {
        limit?: string;
        hideEchoBack?: boolean;
        trueValue?: string[];
        falseValue?: string[];
        caseSensitive?: boolean;
    }): string;
}