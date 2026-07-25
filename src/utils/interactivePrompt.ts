import readline from "readline";

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
  // Defensive reset: if anything upstream ever left stdin in raw mode
  // (arrow-key-style input reads a byte at a time instead of waiting for
  // Enter), readline's question() — which expects cooked/line-buffered
  // mode — would resolve immediately with an empty line instead of
  // actually waiting for input, which looks exactly like "it skipped
  // instead of waiting for my reply."
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
 * Present choices as a numbered plain-text list and read a typed answer via
 * promptWithTimeout — a reliable replacement for the arrow-key select menu
 * this project used to use (selectWithTimeout, removed). That one's timeout
 * relied on an undocumented quirk (closing the live `prompts` Prompt
 * instance to force early resolution) that turned out NOT to reliably
 * fire — in production it hung indefinitely on more than one prompt,
 * waiting on input that was never coming, until an unrelated watchdog
 * eventually killed the whole process. promptWithTimeout's plain
 * `readline.question()` + `rl.close()` is standard, documented Node
 * behavior, not a quirk, so it's used for every CLI decision prompt now.
 *
 * Matches the typed answer by number (e.g. "1"), exact value, or a unique
 * prefix of the value/title (e.g. "s" for "skip" if nothing else starts
 * with s). Falls back to `fallback` on timeout, a blank answer, or
 * anything unrecognized/ambiguous.
 */
export async function promptChoiceWithTimeout<T extends string>(
  message: string,
  choices: { title: string; value: T }[],
  fallback: T,
  timeoutMs: number = PROMPT_TIMEOUT_MS
): Promise<T> {
  const fallbackTitle = choices.find(c => c.value === fallback)?.title ?? fallback;
  const optionsText = choices.map((c, i) => `${i + 1}) ${c.title}`).join("   ");

  const answer = await promptWithTimeout(
    `${message}\n   ${optionsText}\n   (${Math.round(timeoutMs / 1000)}s — defaults to "${fallbackTitle}"): `,
    timeoutMs
  );

  if (!answer) return fallback;
  const trimmed = answer.trim().toLowerCase();

  const asNumber = parseInt(trimmed, 10);
  if (!Number.isNaN(asNumber) && choices[asNumber - 1]) {
    return choices[asNumber - 1]!.value;
  }

  const exact = choices.find(c => c.value.toLowerCase() === trimmed);
  if (exact) return exact.value;

  const prefixMatches = choices.filter(c =>
    c.value.toLowerCase().startsWith(trimmed) || c.title.toLowerCase().startsWith(trimmed)
  );
  if (prefixMatches.length === 1) return prefixMatches[0]!.value;

  return fallback;
}
