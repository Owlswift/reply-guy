import { chromium } from "playwright";

async function main() {
  console.log("Connecting to Chrome on port 9222...");
  
  try {
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    console.log("Connected!");
    
    const context = browser.contexts()[0];
    
    if (!context) {
      console.log("No context found. Make sure Chrome is running with --remote-debugging-port=9222");
      return;
    }
    
    console.log("Context found with", context.pages().length, "pages");
    
    const page = context.pages().find(p => p.url() !== "about:blank") ?? context.pages()[0];
    
    if (!page) {
      console.log("No page found");
      return;
    }
    
    console.log("Current page URL:", page.url());
    
    // If not on x.com, navigate there
    if (!page.url().includes("x.com")) {
      console.log("Navigating to x.com/home...");
      await page.goto("https://x.com/home", { 
        waitUntil: "domcontentloaded",
        timeout: 30000 
      });
    }
    
    console.log("Waiting for timeline...");
    await page.waitForSelector("article", { timeout: 15000 });
    
    const count = await page.locator("article").count();
    console.log("Found", count, "tweets");
    
    // Keep open
    console.log("Keeping page open for 60 seconds...");
    await page.waitForTimeout(60000);
    
  } catch (err) {
    console.error("Error:", err);
    console.log("\nMake sure Chrome is running with:");
    console.log("  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222");
  }
}

main().catch(console.error);