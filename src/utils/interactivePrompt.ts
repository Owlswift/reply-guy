import readline from "readline";

/**
 * Ask the user a question via stdin, with a timeout. Resolves to the
 * trimmed answer, or null if the timeout elapses (or the answer is blank)
 * before they respond. Unlike readline-sync, this doesn't block the event
 * loop, so a timer can actually fire while waiting for input.
 */
export async function promptWithTimeout(question: string, timeoutMs: number): Promise<string | null> {
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
