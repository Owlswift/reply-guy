import { Page } from "playwright";
import { getBrowserAndContext } from "../browser/browser";
import { buildPrompt, PromptInput } from "./buildPrompt";
import { log } from "../utils/logger";

/**
 * ChatGPTClient - Automates chat.openai.com via Playwright
 *
 * Uses a new tab in the same browser Echo is already connected to.
 * No second browser instance needed.
 */
export class ChatGPTClient {
  private page: Page | null = null;

  /**
   * Open a new tab and navigate to ChatGPT.
   */
  async init(): Promise<void> {
    const { context } = await getBrowserAndContext();
    this.page = await context!.newPage();

    log("[ChatGPT] Opening chatgpt.com...");
    await this.page.goto("https://chatgpt.com", {
      waitUntil: "domcontentloaded",
    });

    // Wait for the message input (ProseMirror) to be ready
    try {
      await this.page.waitForSelector(".ProseMirror", { timeout: 30_000 });
      log("[ChatGPT] Input ready");
    } catch {
      log("[ChatGPT] No ProseMirror found — may need login");
      throw new Error("ChatGPT input not found. Is the page loaded and logged in?");
    }
  }

  /**
   * Generate a reply by pasting the prompt into ChatGPT and reading the response.
   *
   * @param input - The tweet and context (same format as Ollama's generateReply)
   * @returns The generated reply text
   */
  async generateReply(input: PromptInput): Promise<string> {
    const page = this.page;
    if (!page) {
      throw new Error("ChatGPTClient not initialized. Call init() first.");
    }

    // Build the prompt exactly as Echo's personality system does
    const { prompt } = await buildPrompt(input);

    // Find the input field
    const inputField = page.locator(".ProseMirror");

    // Click to focus
    await inputField.click();
    await page.waitForTimeout(500);

    // Clear any existing text
    await inputField.fill("");

    // Type the prompt into ChatGPT
    log("[ChatGPT] Sending prompt...");
    await inputField.fill(prompt);

    // Wait a beat so ChatGPT registers the input
    await page.waitForTimeout(800);

    // Press Enter to send — if Shift+Enter is needed instead, fall back
    await page.keyboard.press("Enter");

    // Wait for generation to finish:
    // The stop button appears while generating, disappears when done
    log("[ChatGPT] Waiting for response...");
    try {
      await page.waitForSelector('[data-testid="stop-button"]', { timeout: 5_000 });
      // Generation started — wait for stop button to disappear
      await page.waitForSelector('[data-testid="stop-button"]', {
        state: "detached",
        timeout: 120_000,
      });
    } catch {
      // Stop button may not appear for very short responses
      // Just wait a bit and check
      await page.waitForTimeout(5_000);
    }
    log("[ChatGPT] Response ready");

    // Read the last assistant message
    const reply = await this.readLastAssistantMessage(page);

    // Validate that we got an actual response, not an error message
    if (!reply || reply.length < 10) {
      throw new Error("ChatGPT returned empty or too short response");
    }

    // Check for common error indicators
    const errorPatterns = [
      "enable javascript",
      "enable cookies",
      "challenge-error",
      "verify you are human",
      "cloudflare",
      "access denied",
      "error occurred"
    ];

    const lowerReply = reply.toLowerCase();
    const hasError = errorPatterns.some(pattern => lowerReply.includes(pattern));

    if (hasError) {
      throw new Error(`ChatGPT returned error page: ${reply.substring(0, 100)}`);
    }

    // Check if reply contains HTML tags (indicates error page or malformed response)
    if (reply.includes('<div') || reply.includes('<span') || reply.includes('<html')) {
      throw new Error(`ChatGPT returned HTML content instead of text: ${reply.substring(0, 100)}`);
    }

    return reply;
  }

  /**
   * Read the last assistant message from the chat.
   * Looks for the last message that doesn't have a user-like role.
   */
  private async readLastAssistantMessage(page: Page): Promise<string> {
    // Try multiple strategies to find the response

    // Strategy 1: Look for conversation items with data-message-author-role="assistant"
    try {
      const assistantMessages = page.locator(
        '[data-message-author-role="assistant"]'
      );
      const count = await assistantMessages.count();

      if (count > 0) {
        const lastMessage = assistantMessages.nth(count - 1);
        const text = await lastMessage.textContent({ timeout: 5_000 });
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      }
    } catch {
      // Fall through
    }

    // Strategy 2: Find the last article or div that looks like an assistant message
    try {
      const messages = page.locator(
        '[data-message-author-role="assistant"] .markdown, ' +
          '[data-message-author-role="assistant"] [data-message-text]'
      );
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

    // Strategy 3: Get the last group of text that follows a user message
    try {
      const allArticles = page.locator("article");
      const count = await allArticles.count();
      if (count >= 2) {
        // The last article should be the assistant's response
        const text = await allArticles.nth(count - 1).textContent({ timeout: 5_000 });
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      }
    } catch {
      // Fall through
    }

    // Strategy 4: Last resort — get all visible text content from the main area
    try {
      const mainArea = page.locator('[role="main"], .chat, .conversation');
      const text = await mainArea.textContent({ timeout: 5_000 });
      if (text && text.trim().length > 0) {
        return text.trim();
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