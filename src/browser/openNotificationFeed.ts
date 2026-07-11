import { Page } from "playwright";

export async function openNotificationFeed(page: Page) {
    // If already there, don't reload unnecessarily
    if (page.url().includes("/notifications")) {
        // Check if we're already on the posts feed
        if (page.url().includes("/notifications/posts")) {
            return true;
        }
    } else {
        await page.goto("https://x.com/notifications", {
            waitUntil: "domcontentloaded",
        });
    }

    // Click "New post notifications" tab to get to the Posts feed
    const newPostTab = page.locator('a[href*="/notifications/posts"]');
    if (await newPostTab.count() > 0) {
        await newPostTab.first().click();
        await page.waitForTimeout(1000);
    }

    // Wait until notification cards begin loading
    try {
        await page.waitForSelector("article", {
            timeout: 15000,
        });
    } catch {
        return false;
    }

    return true;
}