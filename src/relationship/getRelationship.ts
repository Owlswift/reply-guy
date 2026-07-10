import { Page } from "playwright";
import { Relationship } from "./types";

export async function getRelationship(page: Page): Promise<Relationship> {
  const body =
    (await page.locator("body").innerText()).toLowerCase();

  if (body.includes("follows you"))
    return "mutual";

  if (body.includes("following"))
    return "following";

  if (body.includes("verified"))
    return "verified";

  return "stranger";
}