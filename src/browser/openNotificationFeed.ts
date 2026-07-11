import { Page } from "playwright";

export async function openNotificationFeed(page: Page) {
    console.log("[openNotificationFeed] Navigating to /notifications...");
    
    // Navigate to notifications
    await page.goto("https://x.com/notifications", {
        waitUntil: "domcontentloaded",
    });
    console.log("[openNotificationFeed] Navigation complete");

    // Wait until notification cards are rendered (shorter timeout)
    try {
        await page.waitForLoadState("networkidle", { timeout: 5000 });
        console.log("[openNotificationFeed] Network idle achieved");
    } catch (err) {
        console.log("[openNotificationFeed] Network idle timeout, continuing anyway...");
    }
    
    console.log("[openNotificationFeed] Waiting for article elements...");
    try {
        await page.locator("article").first().waitFor({
            timeout: 10000
        });
        console.log("[openNotificationFeed] Article elements found");
    } catch (err) {
        console.log("[openNotificationFeed] No article elements found, returning false");
        return false;
    }

    // Find notification cards that start with "New post notifications for"
    console.log("[openNotificationFeed] Looking for 'New post notifications for' cards...");
    const card = page.locator("article").filter({
        has: page.getByText(/^New post notifications for/)
    });

    const count = await card.count();
    console.log(`[openNotificationFeed] Found ${count} matching cards`);

    if (count === 0) {
        console.log("[openNotificationFeed] No matching cards, might already be on posts feed");
        return true;
    }

    try {
        await card.first().waitFor({ timeout: 5000 });
        console.log("[openNotificationFeed] Clicking first card...");
        await card.first().click();
        console.log("[openNotificationFeed] Click complete");
    } catch (err) {
        console.log("[openNotificationFeed] Click failed or no card found, returning true");
        return true;
    }

    // Wait for the Posts feed to open
    console.log("[openNotificationFeed] Waiting for posts feed to load...");
    try {
        await page.locator("article").first().waitFor({
            timeout: 5000
        });
        console.log("[openNotificationFeed] Posts feed loaded successfully");
    } catch (err) {
        console.log("[openNotificationFeed] Posts feed load timeout, returning false");
        return false;
    }

    console.log("[openNotificationFeed] Complete, returning true");
    return true;
}