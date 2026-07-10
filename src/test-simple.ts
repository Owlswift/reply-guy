import { getPage } from "./browser/browser";

async function main() {
  console.log("Connecting to browser...");
  const page = await getPage();
  
  console.log("Current URL:", page.url());
  
  // If not on x.com, navigate there
  if (!page.url().includes("x.com")) {
    console.log("Navigating to x.com/home...");
    await page.goto("https://x.com/home", { waitUntil: "networkidle" });
  }
  
  console.log("Waiting for timeline...");
  await page.waitForSelector("article", { timeout: 15000 });
  
  console.log("Timeline loaded!");
  
  // Get tweet count
  const count = await page.locator("article").count();
  console.log("Found", count, "tweets");
  
  // Keep open
  console.log("Keeping page open for 30 seconds...");
  await page.waitForTimeout(30000);
}

main().catch(console.error);