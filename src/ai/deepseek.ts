import { Page } from "playwright";
import { getBrowserAndContext } from "../browser/browser";
import { buildPrompt, PromptInput } from "./buildPrompt";
import { log } from "../utils/logger";
import { isLikelyAiErrorMessage } from "./errorDetection";
import { parseStructuredReply } from "./parseStructuredReply";

/**
 * DeepSeekClient - Automates chat.deepseek.com via Playwright, mirroring
 * ChatGPTClient/GeminiClient's interface so main-interactive.ts can swap
 * between all three behind the same shape.
 *
 * Selectors below were verified live against chat.deepseek.com (not
 * guessed) — the input is a plain <textarea placeholder="Message
 * DeepSeek">, and responses render inside ".ds-markdown" elements.
 *
 * Unlike ChatGPT/Gemini, no "stop generating" button could be confirmed
 * live (a quick generation completed before any candidate selector could
 * be caught mid-stream). Rather than guess a selector that might not
 * exist, completion is detected by polling the response text until it
 * stops changing for a few consecutive checks — a DOM-agnostic signal
 * that works regardless of what DeepSeek's own "stop" control looks like.
 *
 * Uses a new tab in the same browser Echo is already connected to.
 * No second browser instance needed.
 */
export class DeepSeekClient {
  private page: Page | null = null;

  /**
   * Open a new tab and navigate to DeepSeek.
   */
  async init(): Promise<void> {
    const { context } = await getBrowserAndContext();
    this.page = await context!.newPage();

    log("[DeepSeek] Opening chat.deepseek.com...");
    await this.page.goto("https://chat.deepseek.com", {
      waitUntil: "domcontentloaded",
    });

    try {
      await this.page.waitForSelector("textarea[placeholder='Message DeepSeek']", { timeout: 30_000 });
      log("[DeepSeek] Input ready");
    } catch {
      log("[DeepSeek] No input textarea found — may need login");
      throw new Error("DeepSeek input not found. Is the page loaded and logged in?");
    }
  }

  /**
   * Generate a reply by typing the prompt into DeepSeek and reading the response.
   *
   * @param input - The tweet and context (same format as ChatGPT's/Gemini's generateReply)
   * @returns The generated reply text
   */
  async generateReply(input: PromptInput): Promise<string> {
    const page = this.page;
    if (!page) {
      throw new Error("DeepSeekClient not initialized. Call init() first.");
    }

    // Build the prompt exactly as Echo's personality system does
    const { prompt } = await buildPrompt(input);

    // Find the input field
    const inputField = page.locator("textarea[placeholder='Message DeepSeek']").first();

    // Click to focus
    await inputField.click();
    await page.waitForTimeout(500);

    // Clear any existing text
    await inputField.fill("");

    // Type the prompt into DeepSeek
    log("[DeepSeek] Sending prompt...");
    await inputField.fill(prompt);

    // Wait a beat so DeepSeek registers the input
    await page.waitForTimeout(800);

    // Press Enter to send — verified working live.
    await page.keyboard.press("Enter");

    // Wait for generation to finish. No confirmed stop-button selector
    // (see class doc comment) — poll the last .ds-markdown block until its
    // text stops growing/changing for a few consecutive checks instead.
    log("[DeepSeek] Waiting for response...");
    await this.waitForResponseToStabilize(page);
    log("[DeepSeek] Response ready");

    // Read the last response
    const reply = await this.readLastResponse(page);

    // Validate that we got an actual response, not an error message
    if (!reply || reply.length < 10) {
      throw new Error("DeepSeek returned empty or too short response");
    }

    // Check for common error indicators — shared list across every
    // provider (src/ai/errorDetection.ts), not a separately-maintained
    // copy per file.
    if (isLikelyAiErrorMessage(reply)) {
      throw new Error(`DeepSeek returned error page: ${reply.substring(0, 100)}`);
    }

    if (reply.includes('<div') || reply.includes('<span') || reply.includes('<html')) {
      throw new Error(`DeepSeek returned HTML content instead of text: ${reply.substring(0, 100)}`);
    }

    // The prompt asks for "UNDERSTANDING: ...\nREPLY: ..." (prompt.ts's
    // Stage 1/Stage 2 structure) so the model's own read on the tweet is
    // visible for a human to assess, not just its final output. Log it
    // and return only the reply text.
    const { understanding, reply: replyText } = parseStructuredReply(reply);
    if (understanding) {
      log(`[DeepSeek] Understanding: ${understanding}`);
    } else {
      log(`[DeepSeek] No structured understanding found in response — model didn't follow the output format this time.`);
    }

    return replyText;
  }

  /**
   * Poll the last .ds-markdown block's text until it stops changing for
   * STABLE_CHECKS consecutive polls, or MAX_WAIT_MS elapses. This is the
   * completion signal in place of a confirmed "stop generating" selector.
   */
  private async waitForResponseToStabilize(page: Page): Promise<void> {
    const MAX_WAIT_MS = 120_000;
    const CHECK_INTERVAL_MS = 1_200;
    const STABLE_CHECKS_REQUIRED = 3;

    const start = Date.now();
    let lastText: string | null = null;
    let stableCount = 0;

    while (Date.now() - start < MAX_WAIT_MS) {
      await page.waitForTimeout(CHECK_INTERVAL_MS);

      const text = await page.locator(".ds-markdown").last().textContent({ timeout: 2_000 }).catch(() => null);

      if (text && text.length > 0 && text === lastText) {
        stableCount++;
        if (stableCount >= STABLE_CHECKS_REQUIRED) return;
      } else {
        stableCount = 0;
        lastText = text;
      }
    }
    // Timed out without stabilizing — proceed anyway and let the
    // length/error validation in generateReply catch a bad result.
  }

  /**
   * Read the last assistant response. ".ds-markdown" is the response's own
   * content block — DeepSeek renders the user's own echoed message in a
   * separate structure, so the last ".ds-markdown" match is always the
   * model's reply, never our own prompt.
   */
  private async readLastResponse(page: Page): Promise<string> {
    try {
      const messages = page.locator(".ds-markdown");
      const count = await messages.count();
      if (count > 0) {
        const text = await messages.nth(count - 1).textContent({ timeout: 5_000 });
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      }
    } catch {
      // Fall through
    }

    // Fallback: broader class-name match, in case DeepSeek's markup shifts
    // slightly (a hashed/variant class alongside the semantic one).
    try {
      const messages = page.locator("[class*='markdown']");
      const count = await messages.count();
      if (count > 0) {
        const text = await messages.nth(count - 1).textContent({ timeout: 5_000 });
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      }
    } catch {
      // Fall through
    }

    return "";
  }

  /**
   * Clean up the page when done.
   */
  async close(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
  }
}
