import { chromium, BrowserContext, Page } from "playwright";

let context: BrowserContext | undefined;
let page: Page | undefined;

export async function getPage() {
  if (page) return page;

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  context = browser.contexts()[0];

  page = context?.pages()[0] ?? await context!.newPage();

  return page;
}