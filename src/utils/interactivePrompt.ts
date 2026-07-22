import readline from "readline";
import prompts from "prompts";

/**
 * How long any interactive decision prompt waits for the operator before
 * giving up and moving on to the next tweet. Shared by every prompt in
 * cli/ so the pipeline never stalls unattended for more than this long.
 */
export const PROMPT_TIMEOUT_MS = 20_000;

/**
 * Ask the user a question via stdin, with a timeout. Resolves to the
 * trimmed answer, or null if the timeout elapses (or the answer is blank)
 * before they respond. Unlike readline-sync, this doesn't block the event
 * loop, so a timer can actually fire while waiting for input.
 */
export async function promptWithTimeout(question: string, timeoutMs: number): Promise<string | null> {
  // selectWithTimeout()'s prompts-based select puts stdin into raw mode to
  // read arrow keys without waiting for Enter. If a caller runs this right
  // after one of those (e.g. the image-decision gate, then "type your
  // reply"), stdin can still be in raw mode here — readline's question()
  // expects cooked/line-buffered mode, and without this reset it resolves
  // immediately with an empty line instead of actually waiting for input,
  // which looks exactly like "it skipped instead of waiting for my reply."
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(null);
    }, timeoutMs);

    rl.question(question, (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed.length > 0 ? trimmed : null);
    });
  });
}

/**
 * Show a `prompts` select menu that gives up and resolves to `fallback` if
 * the operator hasn't answered within `timeoutMs` (default PROMPT_TIMEOUT_MS).
 *
 * `prompts` has no native timeout, so this relies on a documented quirk of
 * its element classes: Node's EventEmitter invokes listeners with `this`
 * bound to the emitter, so a non-arrow `onState` callback captures the live
 * Prompt instance — closing it externally forces its promise to resolve
 * immediately instead of waiting on stdin forever.
 */
export async function selectWithTimeout<T extends string>(
  message: string,
  choices: { title: string; value: T }[],
  fallback: T,
  timeoutMs: number = PROMPT_TIMEOUT_MS
): Promise<T> {
  let instance: { close: () => void } | null = null;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    instance?.close();
  }, timeoutMs);

  const response = await prompts({
    type: "select",
    name: "choice",
    message,
    choices,
    initial: 0,
    onState(this: { close: () => void }) {
      instance = this;
    }
  });

  clearTimeout(timer);

  if (timedOut || response.choice === undefined) {
    return fallback;
  }
  return response.choice as T;
}
