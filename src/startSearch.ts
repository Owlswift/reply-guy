import "dotenv/config";
import { Page } from "playwright";
import { getBrowserAndContext } from "./browser/browser";
import { createNavigator } from "./browser/BrowserNavigator";
import { NotificationFeedSource } from "./sources/NotificationFeedSource";
import { extractCurrentTweet } from "./browser/extractTweet";
import { scrollTimeline } from "./browser/scroll";
import { getStoryTellerHandles, recordStoryTeller } from "./storage/storyTellerHandles";
import { promptStoryTellerDecision } from "./cli/promptStoryTellerDecision";
import { shouldLikeTweet } from "./decision/shouldLikeTweet";
import { acquirePostLock, releasePostLock } from "./storage/postLock";
import { log } from "./utils/logger";
import { TimelineTweet } from "./types/tweet";

// Same check as main-interactive.ts's isSelfRepost — reposting your own
// content isn't "sharing someone else's post," it's still yours.
function isSelfRepost(tweet: TimelineTweet): boolean {
  if (!tweet.isRepost || !tweet.reposterHandle) return false;
  return tweet.username.replace(/^@/, "").toLowerCase() === tweet.reposterHandle.toLowerCase();
}

/**
 * Like a post directly on the timeline card it's already rendered on —
 * no tab-open needed, matching every pre-open filter below (they're all
 * decided from data the feed scan already has). Locates the matching
 * article by status id (same href-matching approach openReplyBox.ts uses
 * for targetTweetId) since `tweet` here is just a plain data snapshot,
 * not a live DOM handle.
 *
 * Queued behind storage/postLock.ts — the same turnstile clickReply() uses
 * — so a like from this script can never land at the exact same moment as
 * a reply posting anywhere else, and (via the lock's existing cooldown)
 * doesn't fire in a rapid burst while scrolling either.
 */
async function likeTweetOnFeed(page: Page, tweet: TimelineTweet): Promise<boolean> {
  const articles = page.locator("article");
  const count = await articles.count();

  for (let i = 0; i < count; i++) {
    const article = articles.nth(i);
    const isMatch = await article.evaluate((el, id) => {
      const link = el.querySelector(`a[href*="/status/${id}"]`);
      return !!link;
    }, tweet.id).catch(() => false);
    if (!isMatch) continue;

    // Already liked — X swaps the testid once liked, and clicking
    // [data-testid="like"] again would actually be "unlike".
    if (await article.locator('[data-testid="unlike"]').first().isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }

    const likeButton = article.locator('[data-testid="like"]').first();
    if (!(await likeButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      return false;
    }

    await acquirePostLock();
    try {
      // The lock wait above can run long (another script mid-post plus its
      // own cooldown) while X's live feed keeps reflowing underneath us —
      // the button located before the wait may no longer be attached, or
      // the article may have scrolled out and been unmounted. Re-check
      // right before clicking instead of trusting the earlier check.
      if (!(await likeButton.isVisible({ timeout: 2000 }).catch(() => false))) {
        return false;
      }
      await likeButton.click({ timeout: 5000 });
    } catch (err) {
      log(`[Search] Could not click like for ${tweet.url}: ${err}`);
      return false;
    } finally {
      await releasePostLock();
    }
    return true;
  }

  return false;
}

/**
 * Pure discovery tool — scrolls the same feed main-interactive.ts already
 * watches (BrowserNavigator + NotificationFeedSource's "New post
 * notifications" card, i.e. new original posts from accounts you follow,
 * not literal X search or the raw algorithmic home feed) and, for every
 * post that's structurally a thread (TweetDetails.isThread —
 * extractTweet.ts; see storage/storyTellerHandles.ts's doc comment for why
 * that's the right signal, not classifyTweet's text-category "story"),
 * asks whether to add the author to the story-teller handle list that
 * `pnpm catchup:stories` later runs over.
 *
 * Never drafts or posts a reply — this only ever collects handles, with
 * the operator confirming every addition. No hourly-quota gate needed for
 * that reason.
 */
async function main() {
  // Own dedicated tabs, both freshly opened — not getPage()'s "reuse
  // whatever tab is already sitting open" behavior, which could grab a
  // tab the operator is actively using for something else.
  const { context } = await getBrowserAndContext();
  const page = await context.newPage();
  const navigator = createNavigator(page);
  const tweetPage = await context.newPage();
  tweetPage.on("dialog", (dialog) => {
    dialog.dismiss().catch(() => {});
  });

  const source = new NotificationFeedSource();

  log("[Search] Navigating to notifications...");
  await source.getTweets(page, navigator);

  let checked = 0;
  let pushed = 0;

  // Every tweet gets an explicit SKIP/OPEN/PUSH log line with why —
  // otherwise the only visible output is an aggregate count, which gives
  // no way to tell whether a specific post was skipped for a real reason
  // or something's wrong with a filter.
  const logSkip = (tweet: { url: string; username: string }, reason: string) => {
    log(`[Search] SKIP ${tweet.url} — ${reason} (${tweet.username})`);
  };

  // Every tweet ID gets exactly one like/skip judgment across the whole
  // run, even though getTweets() returns overlapping batches as the feed
  // scrolls (already-seen tweets stay in view). Declared outside the loop
  // so it persists across scroll iterations.
  const consideredForLike = new Set<string>();

  while (true) {
    const tweets = await source.getTweets(page, navigator);
    log(`[Search] ${tweets.length} post(s) visible — scanning for threads.`);

    const known = new Set(await getStoryTellerHandles());

    for (const tweet of tweets) {
      const cleanUsername = tweet.username.replace(/^@/, "").toLowerCase();

      // Every tweet gets a like/skip judgment once, on its own merits,
      // decoupled entirely from whether it ends up a story-teller candidate
      // below. Original content (not a repost of someone else) and
      // self-reposts get liked unconditionally — no AI call needed, it's
      // your own activity either way. Only an actual repost of someone
      // ELSE's post goes through the AI's "would this genuinely resonate"
      // judgment, since a repost isn't automatically worth liking just
      // because it showed up in the feed.
      if (!consideredForLike.has(tweet.id)) {
        consideredForLike.add(tweet.id);
        const worthLiking = !tweet.isRepost || isSelfRepost(tweet) || (await shouldLikeTweet(tweet));
        if (worthLiking) {
          const liked = await likeTweetOnFeed(page, tweet);
          log(`[Search] ${liked ? "LIKED" : "could not like"} ${tweet.url} (${tweet.username})`);
        }
      }

      // Already collected — no point re-opening the tweet or re-asking.
      if (known.has(cleanUsername)) {
        logSkip(tweet, "already in the story-tellers cache");
        continue;
      }

      // Cheap pre-filter using what's already on the timeline card, before
      // spending a tab-open on it — same "check eligibility before
      // spending resources" reasoning as the media/reply-restriction gates
      // elsewhere. An image/video post isn't what this command is looking
      // for (it's hunting for text threads).
      if (tweet.hasImage || tweet.hasVideo) {
        logSkip(tweet, `has ${tweet.hasImage ? "image" : "video"}`);
        continue;
      }
      // Character length, not \n count — verified live against real posts:
      // plenty of genuine stories are written as one continuous paragraph
      // with no manual line breaks at all, and a long tweet's timeline-card
      // preview gets truncated by X at ~280 characters (ending in "…")
      // before any of its later line breaks would even show up. Counting
      // newlines in that preview rejected real candidates on both counts.
      // Length doesn't have either failure mode — 120 chars is short enough
      // that it wouldn't cut off a genuine one-paragraph story either.
      if (tweet.text.length < 120) {
        logSkip(tweet, `too short (${tweet.text.length} chars, need 120+)`);
        continue;
      }

      try {
        await tweetPage.goto(tweet.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
        await tweetPage.waitForSelector("article", { timeout: 15_000 });
      } catch (err) {
        logSkip(tweet, `failed to open: ${err}`);
        continue;
      }

      checked++;
      const details = await extractCurrentTweet(tweetPage);
      if (!details) {
        logSkip(tweet, "could not extract tweet content after opening");
        continue;
      }
      if (!details.isThread) {
        logSkip(tweet, "not structurally a thread (isThread false)");
        continue;
      }

      const cleanHandle = details.handle.replace(/^@/, "").toLowerCase();
      if (known.has(cleanHandle)) {
        logSkip(tweet, `@${cleanHandle} already in the story-tellers cache`);
        continue;
      }

      const decision = await promptStoryTellerDecision(cleanHandle, details.fullText || details.text);
      if (decision === "push") {
        await recordStoryTeller(details.handle);
        known.add(cleanHandle);
        pushed++;
        log(`[Search] PUSH @${cleanHandle} — ${tweet.url}`);
      } else {
        logSkip(tweet, `operator declined/timed out (@${cleanHandle})`);
      }
    }

    log(`[Search] ${checked} checked, ${pushed} pushed so far. Scrolling for more...`);
    await scrollTimeline(page);
    await page.waitForTimeout(2000);
  }
}

main().catch((err) => {
  console.error("[Search] Fatal error:", err);
  process.exit(1);
});
