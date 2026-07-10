import { chromium, BrowserContext, Page } from "playwright";

export async function getPage() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("No browser context found. Make sure Chrome is running with --remote-debugging-port=9222");
  }

  // Get the first available page or create a new one
  let page = context.pages().find(p => p.url() !== "about:blank") ?? context.pages()[0] ?? await context.newPage();

  return page;
}
