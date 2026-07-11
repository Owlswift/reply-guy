import { Page } from "playwright";

export async function openNotificationFeed(page: Page) {
    // Navigate to notifications
    await page.goto("https://x.com/notifications", {
        waitUntil: "domcontentloaded",
    });

    // Wait until notification cards are rendered
    await page.waitForLoadState("networkidle");
    
    try {
        await page.locator("article").first().waitFor({
            timeout: 15000
        });
    } catch {
        return false;
    }

    // Find notification cards that start with "New post notifications for"
    const card = page.locator("article").filter({
        has: page.getByText(/^New post notifications for/)
    });

    try {
        await card.first().waitFor({ timeout: 10000 });
        await card.first().click();
    } catch {
        // No notification card found, might already be on posts feed
        return true;
    }

    // Wait for the Posts feed to open
    try {
        await page.locator("article").first().waitFor({
            timeout: 10000
        });
    } catch {
        return false;
    }

    return true;
}