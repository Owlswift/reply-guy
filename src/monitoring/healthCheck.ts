import { Page } from "playwright";
import { db } from "../database/db";

export async function checkBrowser(page: Page): Promise<"healthy" | "degraded" | "failed"> {
  try {
    const isLoggedIn = await page.locator('[data-testid="SideNav_NewTweet_Button"]').isVisible();
    return isLoggedIn ? "healthy" : "failed";
  } catch {
    return "failed";
  }
}

export async function checkDatabase(): Promise<"healthy" | "degraded" | "failed"> {
  try {
    db.prepare("SELECT 1").get();
    return "healthy";
  } catch {
    return "failed";
  }
}

export async function checkOllama(): Promise<"healthy" | "degraded" | "failed"> {
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      method: "GET"
    });
    return response.ok ? "healthy" : "failed";
  } catch {
    return "failed";
  }
}

export async function checkInternet(): Promise<"healthy" | "degraded" | "failed"> {
  try {
    const response = await fetch("https://google.com", {
      method: "HEAD"
    });
    return response.ok ? "healthy" : "degraded";
  } catch {
    return "failed";
  }
}