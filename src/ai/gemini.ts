import { Page } from "playwright";
import { getBrowserAndContext } from "../browser/browser";
import { buildPrompt, PromptInput } from "./buildPrompt";
import { log } from "../utils/logger";

/**
 * GeminiClient - Automates gemini.google.com via Playwright, mirroring
 * ChatGPTClient (ai/chatgpt.ts) exactly so main-interactive.ts can swap
 * between the two behind the same interface.
 *
 * Selectors below were verified live against gemini.google.com (not
 * guessed) — Gemini's input is a Quill-based rich-textarea, not the
 * ProseMirror editor ChatGPT uses, and its response DOM uses Angular
 * custom elements (<model-response>, <message-content>) instead of
 * data-message-author-role attributes.
 *
 * Uses a new tab in the same browser Echo is already connected to.
 * No second browser instance needed.
 */
export class GeminiClient {
  private page: Page | null = null;

  /**
   * Open a new tab and navigate to Gemini.
   */
  async init(): Promise<void> {
    const { context } = await getBrowserAndContext();
    this.page = await context!.newPage();

    log("[Gemini] Opening gemini.google.com...");
    await this.page.goto("https://gemini.google.com/app", {
      waitUntil: "domcontentloaded",
    });

    // Wait for the message input (Quill editor) to be ready
    try {
      await this.page.waitForSelector("div.ql-editor", { timeout: 30_000 });
      log("[Gemini] Input ready");
    } catch {
      log("[Gemini] No input editor found — may need login");
      throw new Error("Gemini input not found. Is the page loaded and logged in?");
    }
  }

  /**
   * Generate a reply by typing the prompt into Gemini and reading the response.
   *
   * @param input - The tweet and context (same format as ChatGPT's generateReply)
   * @returns The generated reply text
   */
  async generateReply(input: PromptInput): Promise<string> {
    const page = this.page;
    if (!page) {
      throw new Error("GeminiClient not initialized. Call init() first.");
    }

    // Build the prompt exactly as Echo's personality system does
    const { prompt } = await buildPrompt(input);

    // Find the input field
    const inputField = page.locator("div.ql-editor").first();

    // Click to focus
    await inputField.click();
    await page.waitForTimeout(500);

    // Clear any existing text
    await inputField.fill("");

    // Type the prompt into Gemini
    log("[Gemini] Sending prompt...");
    await inputField.fill(prompt);

    // Wait a beat so Gemini registers the input
    await page.waitForTimeout(800);

    // Press Enter to send — verified working (Gemini also has a
    // button[aria-label*="Send message"], but Enter matches ChatGPT's
    // approach and was confirmed live).
    await page.keyboard.press("Enter");

    // Wait for generation to finish: the stop button appears while
    // generating, disappears when done — same pattern as ChatGPT's
    // stop-button, just a different selector.
    log("[Gemini] Waiting for response...");
    try {
      await page.waitForSelector("button[aria-label*='Stop']", { timeout: 5_000 });
      await page.waitForSelector("button[aria-label*='Stop']", {
        state: "detached",
        timeout: 120_000,
      });
    } catch {
      // Stop button may not appear for very short responses
      await page.waitForTimeout(5_000);
    }
    log("[Gemini] Response ready");

    // Read the last model response
    const reply = await this.readLastModelResponse(page);

    // Validate that we got an actual response, not an error message
    if (!reply || reply.length < 10) {
      throw new Error("Gemini returned empty or too short response");
    }

    // Check for common error indicators — same categories as chatgpt.ts's
    // check (a stalled/failed generation, a login/consent wall, etc.)
    const errorPatterns = [
      "enable javascript",
      "enable cookies",
      "challenge-error",
      "verify you are human",
      "cloudflare",
      "access denied",
      "error occurred",
      "something went wrong",
      "help.google.com",
      "if this issue persists",
      "i'm having trouble",
    ];

    const lowerReply = reply.toLowerCase();
    const hasError = errorPatterns.some(pattern => lowerReply.includes(pattern));

    if (hasError) {
      throw new Error(`Gemini returned error page: ${reply.substring(0, 100)}`);
    }

    // Check if reply contains HTML tags (indicates error page or malformed response)
    if (reply.includes('<div') || reply.includes('<span') || reply.includes('<html')) {
      throw new Error(`Gemini returned HTML content instead of text: ${reply.substring(0, 100)}`);
    }

    return reply;
  }

  /**
   * Read the last model response from the chat.
   *
   * <message-content> lives specifically inside <model-response> — Gemini
   * uses a separate <user-query-content> element for the user's own echoed
   * message, so this never accidentally picks up our own prompt.
   */
  private async readLastModelResponse(page: Page): Promise<string> {
    // Strategy 1: the verified-clean selector
    try {
      const messages = page.locator("message-content");
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

    // Strategy 2: markdown content inside the last model-response
    try {
      const messages = page.locator("model-response .markdown");
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

    // Strategy 3: any .markdown on the page
    try {
      const messages = page.locator(".markdown");
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

    // Strategy 4: last resort — the last model-response element as a whole
    try {
      const responses = page.locator("model-response");
      const count = await responses.count();
      if (count > 0) {
        const text = await responses.nth(count - 1).textContent({ timeout: 5_000 });
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
