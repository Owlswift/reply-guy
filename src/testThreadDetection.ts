import { getPage } from "./browser/browser";
import { extractCurrentTweet, TweetDetails } from "./browser/extractTweet";

/**
 * Manual test for the thread root-detection logic (extractTweet.ts's
 * isRoot/rootId/rootUrl). Scans a profile's Posts tab, finds candidate
 * thread segments (marked "Replying to" — a self-thread continuation),
 * then runs the ACTUAL extractCurrentTweet() against each one to confirm
 * it correctly resolves to its thread's root instead of replying in place.
 *
 * Requires Echo's own main-interactive.ts NOT to be running at the same
 * time — this reuses the shared getPage() connection (same pattern as
 * browser/test.ts), which would otherwise fight over the same tab.
 */

const HANDLE = process.argv[2] || "katyakayy";

interface RawArticle {
  id: string | null;
  handle: string;
  isReply: boolean;
  text: string;
  datetime: string | null;
}

async function readRawArticle(article: any): Promise<RawArticle> {
  return article.evaluate((el: any) => {
    const anchor = el.querySelector('a[href*="/status/"]');
    const href = anchor?.getAttribute("href") ?? "";
    const idMatch = href.match(/status\/(\d+)/);
    const authorText = el.querySelector('[data-testid="User-Name"]')?.textContent ?? "";
    const handleMatch = authorText.match(/@\w+/);
    const isReply = (el.textContent ?? "").trim().startsWith("Replying to");
    const text = el.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? "";

    const times: any[] = Array.from(el.querySelectorAll("time"));
    let datetime: string | null = null;
    for (const t of times) {
      let node: any = t.parentElement;
      let roleLinkTag: string | null = null;
      while (node && node !== el) {
        if (node.getAttribute("role") === "link") {
          roleLinkTag = node.tagName;
          break;
        }
        node = node.parentElement;
      }
      if (roleLinkTag === "A") {
        datetime = t.getAttribute("datetime");
        break;
      }
    }
    if (!datetime) datetime = times[0]?.getAttribute("datetime") ?? null;

    return {
      id: idMatch?.[1] ?? null,
      handle: handleMatch?.[0] ?? "",
      isReply,
      text,
      datetime,
    };
  });
}

async function main() {
  console.log(`Connecting to browser...`);
  const page = await getPage();

  console.log(`Navigating to https://x.com/${HANDLE} ...`);
  await page.goto(`https://x.com/${HANDLE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("article", { timeout: 15000 });
  await page.waitForTimeout(1500);

  const seen = new Map<string, RawArticle>();
  const order: string[] = [];

  for (let i = 0; i < 8; i++) {
    const articles = await page.locator("article").all();
    for (const a of articles) {
      const info = await readRawArticle(a);
      if (!info.id || seen.has(info.id)) continue;
      seen.set(info.id, info);
      order.push(info.id);
    }
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(800);
  }

  console.log(`\n=== RAW PROFILE SCAN (${order.length} posts) ===\n`);
  for (const id of order) {
    const info = seen.get(id)!;
    const preview = info.text.length > 100 ? info.text.slice(0, 100) + "..." : info.text;
    console.log(`[${id}] ${info.handle}${info.isReply ? " (REPLY/continuation)" : ""} @ ${info.datetime}\n   "${preview}"`);
  }

  // X's profile "Posts" tab does NOT render a "Replying to @self" banner for
  // a self-thread continuation (confirmed empirically — isReply was false
  // for every part of several obvious threads). Group by same-author,
  // closely-timed CONSECUTIVE entries in scan order instead — this is the
  // same signal extractTweet.ts's actual production backward-walk uses
  // (same author + within a time window), just applied here to the raw
  // profile scan to pick candidates worth testing.
  const GROUP_WINDOW_MS = 10 * 60 * 1000;
  const candidates: string[] = [];
  for (let i = 0; i < order.length - 1; i++) {
    const a = seen.get(order[i]!)!;
    const b = seen.get(order[i + 1]!)!;
    if (!a.handle || a.handle !== b.handle || !a.datetime || !b.datetime) continue;
    if (Math.abs(new Date(a.datetime).getTime() - new Date(b.datetime).getTime()) > GROUP_WINDOW_MS) continue;
    // order[i] is newer (scan is newest-first) — it's a later segment of
    // whatever order[i+1] belongs to, so it's the one worth testing.
    if (!candidates.includes(order[i]!)) candidates.push(order[i]!);
  }
  console.log(`\n=== CANDIDATE THREAD SEGMENTS (same-author, within ${GROUP_WINDOW_MS / 60000}min of the next post back): ${candidates.length} ===`);
  for (const id of candidates) {
    console.log(`   https://x.com/${HANDLE}/status/${id}`);
  }

  if (candidates.length === 0) {
    console.log("\nNo thread-continuation segments detected in this scan — nothing further to test.");
    return;
  }

  // Resolve each candidate segment for real, group by the root it points to.
  const rootCache = new Map<string, TweetDetails>();
  const ignoredByRoot = new Map<string, string[]>();

  for (const segmentId of candidates) {
    const segmentUrl = `https://x.com/${HANDLE}/status/${segmentId}`;
    console.log(`\n--- Opening segment ${segmentUrl} ---`);
    await page.goto(segmentUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const details = await extractCurrentTweet(page);

    if (!details) {
      console.log(`   Could not extract — skipping.`);
      continue;
    }

    if (details.isRoot) {
      console.log(`   isRoot=true — this segment is actually its own thread's root (unexpected for an isReply-flagged post, worth checking manually).`);
      continue;
    }

    if (!details.rootId || !details.rootUrl) {
      console.log(`   isRoot=false but no rootId/rootUrl resolved — backward-walk didn't find the root (possibly a reply to someone else, not a self-thread).`);
      continue;
    }

    console.log(`   -> redirects to root ${details.rootId}`);
    const list = ignoredByRoot.get(details.rootId) ?? [];
    list.push(segmentUrl);
    ignoredByRoot.set(details.rootId, list);

    if (!rootCache.has(details.rootId)) {
      await page.goto(details.rootUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const rootDetails = await extractCurrentTweet(page);
      if (rootDetails) rootCache.set(details.rootId, rootDetails);
    }
  }

  console.log(`\n\n=== SUMMARY: ${rootCache.size} thread(s) detected ===`);
  for (const [rootId, rootDetails] of rootCache) {
    console.log(`\nROOT https://x.com/${HANDLE}/status/${rootId}`);
    console.log(`  isRoot: ${rootDetails.isRoot}`);
    console.log(`  Full reconstructed thread text:\n"${rootDetails.fullText}"`);
    console.log(`  IGNORED (redirected, never replied to directly):`);
    for (const url of ignoredByRoot.get(rootId) ?? []) {
      console.log(`    - ${url}`);
    }
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
