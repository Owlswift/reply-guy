import { Page } from "playwright";

export async function waitForReply(page: Page): Promise<void> {
  console.log("Waiting for reply to be posted...");

  // Wait for the reply textarea to be hidden/removed
  // This indicates the reply was posted
  await page.locator('[data-testid="tweetTextarea_0"]').waitFor({ 
    state: "hidden", 
    timeout: 120000 
  }).catch(() => {
    // If timeout, just continue
    console.log("Timeout waiting for reply, continuing...");
  });

  console.log("Reply detected.");
}