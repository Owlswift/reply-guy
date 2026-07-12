import "dotenv/config";
import { getPage } from "./browser/browser";
import { shouldReply } from "./filter/filterTweet";
import { scrollTimeline } from "./browser/scroll";
import { log } from "./utils/logger";
import { updateTimeline, timelineLooksStuck, resetTimelineState } from "./timeline/state";
import { shouldRefreshSession, markSessionRefreshed } from "./utils/session";
import { isLoggedIn } from "./browser/isLoggedIn";
import { enqueue, queueSize, getQueue, QueueItem, dequeue, peek, updateItem } from "./core/queue";
import { sessionManager } from "./core/sessionManager";
import { pollDelay, getProfileLabel } from "./behavior/profiles";
import { SourceManager } from "./sources/SourceManager";
import { HomeTimelineSource } from "./sources/HomeTimelineSource";
import { NotificationFeedSource } from "./sources/NotificationFeedSource";
import { deduplicateTweets } from "./sources/deduplicate";
import { hasTweet } from "./database/tweetRepository";
import { markNotificationSeen, getNotificationProgress } from "./storage/seenNotifications";
import { createNavigator, BrowserNavigator } from "./browser/BrowserNavigator";
import { extractCurrentTweet } from "./browser/extractTweet";
import { readDelay, betweenRepliesDelay, maybeDistractedPause } from "./behavior/profiles";
import { shouldTakeBreak, getBreakDuration } from "./behavior/scheduler";
import { markReplied } from "./storage/repliedTweets";
import { markNotificationReplied } from "./storage/seenNotifications";
import { reviewSession, ReviewSessionDetails } from "./cli/reviewSession";
import { stats } from "./stats/runtime";
import { generateReply } from "./ai/ollama";
import { classifyTweet } from "./ai/classifyTweet";
import { validateReply } from "./personality/validator";
import { isDuplicate } from "./personality/duplicate";
import { describeImages } from "./ai/vision";
import { downloadImages, cleanupImages } from "./ai/downloadImage";

const DAILY_LIMIT = 40;

/**
 * Single-threaded pipeline.
 * 
 * No concurrent workers. No background loops. One sequential flow:
 * 
 *   IDLE → FETCH → QUEUE → OPEN → GENERATE → REVIEW → POST → RETURN → IDLE
 * 
 * Only the BrowserNavigator touches page.goto/page.goBack.
 * Nothing else runs in the background.
 */
async function main() {
  const page = await getPage();
  const navigator = createNavigator(page);
  let replyCount = 0;

  log(`Behavior profile: ${getProfileLabel()}`);

  // Define source manager
  const sourceManager = new SourceManager([
    new NotificationFeedSource(),
    new HomeTimelineSource()
  ]);

  while (replyCount < DAILY_LIMIT) {
    // ============================================================
    // PHASE 1: FETCH — read timeline, fill queue
    // ============================================================
    log("=== PHASE: FETCH ===");

    try {
      // Check if still logged in
      if (!(await isLoggedIn(page))) {
        log("Session expired. Stopping bot.");
        break;
      }

      // Check if we should refresh the session
      if (shouldRefreshSession()) {
        log("Refreshing session...");
        await navigator.refreshSession();
        markSessionRefreshed();
      }

      // Get tweets from all sources (NotificationFeedSource navigates here)
      const rawTweets = await sourceManager.getTweets(page, navigator);

      // Deduplicate tweets
      const tweets = deduplicateTweets(rawTweets);

      // Log statistics
      const duplicateCount = rawTweets.length - tweets.length;
      log(`Merged: ${tweets.length} tweets, ${duplicateCount} duplicates removed`);

      // Log each extracted post with its URL
      if (tweets.length > 0) {
        console.log("\n📋 Extracted posts:");
        for (const t of tweets) {
          console.log(`   [${t.id}] ${t.author} — ${t.url}`);
        }
        console.log();
      }

      // Update timeline state
      updateTimeline(tweets.map(t => t.id));

      // Check if timeline is stuck
      if (timelineLooksStuck()) {
        log("Timeline appears stuck. Refreshing...");
        await navigator.navigateToTimeline();
        resetTimelineState();
        continue;
      }

      // Enqueue tweets (only if not already in queue or already replied)
      for (const tweet of tweets) {
        // Skip if already replied
        if (hasTweet(tweet.id)) {
          continue;
        }
        
        if (shouldReply(tweet)) {
          // Check if already in queue
          const existing = getQueue().find((q: QueueItem) => q.id === tweet.id);
          if (!existing) {
            const item: QueueItem = {
              id: tweet.id,
              url: tweet.url,
              author: tweet.author,
              text: tweet.text,
              createdAt: Date.now(),
              status: "pending"
            };
            enqueue(item);
          }
        }

        // Mark tweet as seen in persistent storage so it's never re-processed
        markNotificationSeen(tweet.id, tweet.url);
      }

      // Show progress summary after processing all tweets
      const progress = getNotificationProgress();
      const remaining = progress.total - progress.replied;
      console.log(`📊 Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)`);

      // Keep queue topped up
      if (queueSize() < 10) {
        log("Queue low, scrolling...");
        await scrollTimeline(page);
      }

      // Random wait before next iteration (driven by the session behavior profile)
      const waitTime = pollDelay();
      log(`Waiting ${waitTime / 1000}s before next check...`);
      await page.waitForTimeout(waitTime);
    } catch (err) {
      console.error("Error in main loop:", err);
      log("Recovering by going to i/timeline...");
      await navigator.navigateToTimeline();
      await page.waitForTimeout(5000);
    }

    // ============================================================
    // PHASE 2: PROCESS — process each queued tweet one at a time
    // ============================================================
    while (queueSize() > 0 && replyCount < DAILY_LIMIT) {
      const item = peek();
      if (!item) break;

      // Only process items that are "ready" (AI has generated a draft)
      // or "pending" (needs AI generation first)
      if (item.status === "pending") {
        // Generate AI draft inline (no background worker)
        log(`=== PHASE: GENERATE DRAFT for ${item.id} ===`);
        updateItem(item.id, { status: "drafting" });

        try {
          // Load recent memories so the AI learns from your edited replies
          const { MemoryRepository } = await import("./database/MemoryRepository");
          const memoryRepo = new MemoryRepository();
          const memories = await memoryRepo.getRecentMemories(20);
          const tweetType = classifyTweet(item.text);

          let reply = "";
          for (let i = 0; i < 3; i++) {
            reply = await generateReply({
              tweet: item.text,
              relationship: "stranger",
              memories
            });
            if (validateReply(reply) && !isDuplicate(reply)) {
              break;
            }
          }

          if (!reply) {
            log(`Failed to generate reply for ${item.id}. Skipping.`);
            dequeue();
            continue;
          }

          updateItem(item.id, { status: "ready", draft: reply });
          stats.regenerated++;
        } catch (err) {
          console.error(`AI error for ${item.id}:`, err);
          dequeue();
          continue;
        }
      }

      // Re-read item (status may have changed)
      const readyItem = peek();
      if (!readyItem || readyItem.status !== "ready") {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Lock the item
      updateItem(readyItem.id, { status: "processing" });

      try {
        // ============================================================
        // PHASE 3: OPEN TWEET
        // ============================================================
        log(`=== PHASE: OPEN TWEET ${readyItem.id} ===`);
        stats.tweets++;
        await navigator.openTweet(readyItem.url);

        // Skip tweets we can't reply to
        const replyButton = page.locator('[data-testid="reply"]').first();
        if (!(await replyButton.isVisible().catch(() => false))) {
          log(`Reply unavailable. Skipping.`);
          await navigator.returnToTimeline();
          dequeue();
          continue;
        }

        // Extract current tweet details
        const details = await extractCurrentTweet(page);

        if (!details) {
          log(`Cannot reply to tweet ${readyItem.id}. Skipping.`);
          await navigator.returnToTimeline();
          dequeue();
          continue;
        }

        // Human-like reading time
        const readTime = readDelay(details.fullText || details.text);
        log(`Reading tweet for ${(readTime / 1000).toFixed(1)}s...`);
        await page.waitForTimeout(readTime);

        // Determine tweet type — greetings and well-wishes get auto-posted without review
        const tweetText = details.fullText || details.text || readyItem.text;
        const tweetType = classifyTweet(tweetText);
        const isAutoPost = tweetType === "greeting" || tweetType === "well_wish";

        if (isAutoPost) {
          // ============================================================
          // PHASE 4a: AUTO-POST (greeting or well-wish, no review needed)
          // ============================================================
          const autoLabel = tweetType === "greeting" ? "greeting" : "well-wish";
          log(`=== AUTO-POST ${autoLabel.toUpperCase()} ===`);
          console.log(`\n🤖 Auto-replying to ${autoLabel}: "${tweetText}"\n`);

          // Open reply box and type the draft
          const { prepareReply, clickReply } = await import("./reply/reply");
          const memoryRepo = new (await import("./database/MemoryRepository")).MemoryRepository();

          const memories = await memoryRepo.getRecentMemories(20);

          // Describe images if present
          let autoImageDescriptions: string[] | undefined;
          if (details.imageUrls && details.imageUrls.length > 0) {
            log(`Describing ${details.imageUrls.length} image(s) via Gemma Vision...`);
            try {
              const localPaths = await downloadImages(details.imageUrls);
              autoImageDescriptions = await describeImages(localPaths);
              cleanupImages(localPaths);
            } catch (err) {
              log(`Vision failed for auto-post: ${err}`);
            }
          }

          const autoDraft = await generateReply({
            tweet: tweetText,
            relationship: readyItem.relationship || "stranger",
            memories,
            ...(autoImageDescriptions ? { imageDescriptions: autoImageDescriptions } : {})
          });

          if (autoDraft) {
            try {
              await prepareReply(page, autoDraft);
              const success = await clickReply(page, details.handle || readyItem.author);
              if (success) {
                // Save to memory
                try {
                  await memoryRepo.saveMemory({
                    id: "",
                    tweetId: readyItem.id,
                    tweetText,
                    authorHandle: details.handle || readyItem.author,
                    relationship: readyItem.relationship || "stranger",
                    aiDraft: `auto-${autoLabel}`,
                    finalReply: autoDraft,
                    wasEdited: false,
                    approved: true,
                    createdAt: new Date()
                  });
                  console.log(`🧠 Saved ${autoLabel} to memory.\n`);
                } catch {}
              }
            } catch (err) {
              console.error(`Failed to auto-post ${autoLabel}:`, err);
            }
          }

          markReplied(readyItem.id);
          markNotificationReplied(readyItem.id);
          dequeue();
          replyCount++;
          stats.posted++;

          const progress = getNotificationProgress();
          const remaining = progress.total - progress.replied;
          console.log(`\n✅ ${autoLabel} reply posted. Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)\n`);
        } else {
          // ============================================================
          // PHASE 4b: REVIEW & POST (normal tweets)
          // ============================================================
          log(`=== PHASE: REVIEW & POST ===`);
          const reviewDetails: ReviewSessionDetails = {
            id: readyItem.id,
            author: details.handle || readyItem.author,
            text: tweetText,
            relationship: readyItem.relationship || "stranger",
            existingDraft: readyItem.draft
          };
          
          const result = await reviewSession(page, navigator, reviewDetails);

          if (result.status === "posted") {
            markReplied(readyItem.id);
            markNotificationReplied(readyItem.id);
            dequeue();
            replyCount++;
            stats.posted++;

            const progress = getNotificationProgress();
            const remaining = progress.total - progress.replied;
            console.log(`\n✅ Reply posted. Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)\n`);

            if (shouldTakeBreak(stats.posted)) {
              const breakMs = getBreakDuration();
              log(`Taking a longer break (${(breakMs / 60000).toFixed(0)} min)...`);
              await page.waitForTimeout(breakMs);
            }
          } else if (result.status === "skipped") {
            dequeue();
            stats.skipped++;
            console.log("\nSkipped.\n");
          } else if (result.status === "regen") {
            updateItem(readyItem.id, { 
              status: "ready",
              draft: result.draft
            });
          } else {
            updateItem(readyItem.id, { status: "ready" });
          }
        }

        // ============================================================
        // PHASE 5: RETURN TO FEED
        // ============================================================
        log(`=== PHASE: RETURN TO FEED ===`);
        await navigator.returnToTimeline();

        // Human-like pause between replies
        if (Math.random() < 0.4) {
          await scrollTimeline(page);
        }
        const between = betweenRepliesDelay();
        log(`Pausing ${(between / 1000).toFixed(1)}s before next tweet...`);
        await page.waitForTimeout(between);

        const distracted = maybeDistractedPause();
        if (distracted > 0) {
          log(`Distracted — pausing ${(distracted / 1000).toFixed(0)}s...`);
          await page.waitForTimeout(distracted);
        }
      } catch (err) {
        log(`Cannot reply to tweet ${readyItem.id}. Skipping.`);
        await navigator.returnToTimeline();
        dequeue();
      }
    }
  }

  log(`Completed ${replyCount} replies today.`);
}

main().catch(console.error);