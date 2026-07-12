import { chromium, BrowserContext, Browser, Page } from "playwright";

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _page: Page | null = null;

/**
 * Connect to the browser via CDP.
 * Caches the browser and context so multiple callers share the same connection.
 */
export async function getBrowserAndContext(): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  if (_browser && _context) {
    return { browser: _browser, context: _context };
  }

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error(
      "No browser context found. Make sure Chrome is running with --remote-debugging-port=9222"
    );
  }

  _browser = browser;
  _context = context;
  return { browser, context };
}

/**
 * Get a page from the shared browser context.
 * Reuses the first existing page or creates a new one.
 */
export async function getPage(): Promise<Page> {
  if (_page) {
    return _page;
  }

  const { context } = await getBrowserAndContext();

  // Get the first available page or create a new one
  const page =
    context.pages().find((p) => p.url() !== "about:blank") ??
    context.pages()[0] ??
    (await context.newPage());

  _page = page;
  return page;
}