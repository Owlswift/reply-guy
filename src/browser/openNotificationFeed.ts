import { Page } from "playwright";

export async function openNotificationFeed(page: Page) {
    // Navigate to notifications
    await page.goto("https://x.com/notifications", {
        waitUntil: "domcontentloaded",
    });

    // Wait until notification cards are rendered
    try {
        await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {
        // Continue anyway
    }
    
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

    const count = await card.count();

    if (count === 0) {
        return true;
    }

    try {
        await card.first().waitFor({ timeout: 5000 });
        await card.first().click();
    } catch {
        return true;
    }

    // Wait for the Posts feed to open
    try {
        await page.locator("article").first().waitFor({
            timeout: 5000
        });
    } catch {
        return false;
    }

    return true;
}