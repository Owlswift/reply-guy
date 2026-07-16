import "dotenv/config";
import { getPage } from "./browser/browser";
import { log, msSinceLastLog } from "./utils/logger";
import { shouldRefreshSession, markSessionRefreshed } from "./utils/session";
import { isLoggedIn } from "./browser/isLoggedIn";
import { enqueue, queueSize, getQueue, QueueItem, peek, dequeue, updateItem, reRankQueue, clearQueue } from "./core/queue";
import { pollDelay, getProfileLabel } from "./behavior/profiles";
import { NotificationFeedSource } from "./sources/NotificationFeedSource";
import { getNotificationProgress, markNotificationSeen, hasNotificationReplied } from "./storage/seenNotifications";
import { hasReplied } from "./storage/repliedTweets";
import { scoreTweet, shouldSkipDueToAgeAndReplies } from "./decision/scoreTweet";
import { createNavigator, BrowserNavigator } from "./browser/BrowserNavigator";
import { extractCurrentTweet } from "./browser/extractTweet";
import { markReplied } from "./storage/repliedTweets";
import { markNotificationReplied } from "./storage/seenNotifications";
import { stats } from "./stats/runtime";
import { getNewestTweetId, setNewestTweetId, setScrollY, getScrollY } from "./timeline/state";
import { ChatGPTClient } from "./ai/chatgpt";
import { classifyTweet } from "./ai/classifyTweet";
import { validateReply } from "./personality/validator";
import { isDuplicate } from "./personality/duplicate";
import { generateReply as generateOllamaReply } from "./ai/generateReply";
import chalk from "chalk";
import { describeImages } from "./ai/vision";
import { downloadImages, cleanupImages } from "./ai/downloadImage";
import { playNotificationSound } from "./utils/notify";
import { promptImageDecision } from "./cli/promptImageDecision";
import { alwaysSendToChatGPT } from "./decision/posterProfiles";
import readlineSync from "readline-sync";
import {
  getReadingTime,
  getMicroBreak,
  getThinkingTime,
  getPostReplyPause,
  maybeInterruption,
  getReplyRatio,
} from "./behavior/scheduler";

const DAILY_LIMIT = 300;

/**
 * Watchdog — Playwright calls against a hung browser tab/CDP connection can
 * sit forever without throwing, so a hang produces total silence rather than
 * an error. We treat "no log() activity for too long" as a hang signal and
 * hard-exit so an external supervisor (see scripts/watch-and-restart.sh) can
 * restart the process with a fresh CDP connection.
 */
const WATCHDOG_CHECK_INTERVAL_MS = 15_000;
const WATCHDOG_HANG_THRESHOLD_MS = 3 * 60 * 1000; // 3 min — comfortably above the ~2 min worst-case legitimate silent gap (ChatGPT generation wait)

function startWatchdog(): NodeJS.Timeout {
  const timer = setInterval(() => {
    const silence = msSinceLastLog();
    if (silence > WATCHDOG_HANG_THRESHOLD_MS) {
      console.error(
        `\n[Watchdog] No activity for ${Math.round(silence / 1000)}s — the browser/CDP connection is likely hung. Exiting so a supervisor can restart the process.\n`
      );
      process.exit(1);
    }
  }, WATCHDOG_CHECK_INTERVAL_MS);
  timer.unref();
  return timer;
}

/**
 * When true, tweets with images are skipped automatically instead of
 * pausing for manual review — lets the bot run fully unattended.
 * Set SKIP_IMAGE_TWEETS=true in .env to enable.
 */
const SKIP_IMAGE_TWEETS = process.env.SKIP_IMAGE_TWEETS === "true";

/**
 * Notification-centric Echo.
 *
 * Instead of polling the home timeline and merging multiple sources, Echo
 * "stands in" the notifications inbox and waits for new post notifications
 * from the creators you've chosen to follow.
 *
 *   Notifications
 *        │
 *        ▼
 *   New post?
 *        ├── Yes → Open → Extract → Generate → Approve → Post → Back
 *        └── No  → Wait random(20–90s) → Loop
 *
 * No home timeline. No endless scrolling. No merged sources.
 * Every notification is a high-quality opportunity because it passed
 * your own follow filter.
 */

/**
 * Detect whether @unfairleverage has already replied in the open thread.
 * Looks for your handle link inside any article after the root tweet, to
 * avoid false matches from sidebar profile cards or "Replying to" text.
 */
async function hasManualReply(page: Awaited<ReturnType<typeof getPage>>): Promise<boolean> {
  const allArticles = page.locator('article');
  const articleCount = await allArticles.count();
  for (let a = 1; a < articleCount; a++) {
    const linkCount = await allArticles.nth(a).locator('a[href="/unfairleverage"]').count();
    if (linkCount > 0) {
      return true;
    }
  }
  return false;
}

async function main() {
  const watchdog = startWatchdog();
  const page = await getPage();
  const navigator = createNavigator(page);

  log(`Behavior profile: ${getProfileLabel()}`);

  // Initialize ChatGPT client (opens a new tab)
  const chatgpt = new ChatGPTClient();
  await chatgpt.init();
  log("ChatGPT client ready");

  // The single source — notifications only
  const notificationSource = new NotificationFeedSource();

  // Navigate to notifications on startup
  log("Navigating to notifications...");
  await notificationSource.getTweets(page, navigator);

  while (stats.posted < DAILY_LIMIT) {
    // ============================================================
    // PHASE 1: WATCH NOTIFICATIONS
    // ============================================================
    log("=== PHASE: WATCH NOTIFICATIONS ===");

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

      // Fetch new post notifications
      console.log("  → Checking notifications...");
      const tweets = await notificationSource.getTweets(page, navigator);
      console.log(`  ✓ Found ${tweets.length} new post notification(s)`);

      if (tweets.length === 0) {
        // Nothing new — scroll to find older posts
        log("No new notifications. Scrolling for older posts...");
        const { scrollTimeline } = await import("./browser/scroll");
        await scrollTimeline(page);
        await page.waitForTimeout(2000);
        continue;
      }

      // Check if ALL visible tweets have already been replied to.
      // If so, scroll down to find older notifications that haven't been replied.
      const allAlreadyReplied = tweets.every(t => hasReplied(t.id));
      if (allAlreadyReplied) {
        log("All visible notifications already replied. Scrolling for older posts...");
        const { scrollTimeline } = await import("./browser/scroll");
        await scrollTimeline(page);
        await page.waitForTimeout(2000);
        continue;
      }

      // Log each notification with score
      console.log("\n📋 New post notifications:");
      for (const t of tweets) {
        const score = scoreTweet(t);
        const skipReason = shouldSkipDueToAgeAndReplies(t) ? " ⛔ SKIP (too old/saturated)" : "";
        console.log(`   [score ${score.toString().padStart(3)}] ${t.author} — ${t.url}${skipReason}`);
      }
      console.log();

      // Enqueue notifications — apply reply ratio
      const replyRatio = getReplyRatio();
      for (const tweet of tweets) {
        // Skip if already replied
        if (hasReplied(tweet.id)) {
          continue;
        }

        // Skip if already in queue
        const existing = getQueue().find((q: QueueItem) => q.id === tweet.id);
        if (existing) {
          continue;
        }

        if (Math.random() > replyRatio) {
          continue;
        }

        // Mark as seen in the database
        markNotificationSeen(tweet.id, tweet.url);

        const item: QueueItem = {
          id: tweet.id,
          url: tweet.url,
          author: tweet.author,
          text: tweet.text,
          createdAt: Date.now(),
          status: "pending"
        };
        enqueue(item, tweet);
      }

      // Re-rank queue (notifications age while we process others)
      reRankQueue();
      console.log(`  ✓ Queue size: ${queueSize()} (priority-ordered)`);

      // Show progress
      const progress = getNotificationProgress();
      const remaining = progress.total - progress.replied;
      console.log(`📊 Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)`);

      // If queue is empty after processing, scroll for more
      if (queueSize() === 0) {
        log("Queue empty. Scrolling for more posts...");
        const { scrollTimeline } = await import("./browser/scroll");
        await scrollTimeline(page);
        await page.waitForTimeout(2000);
      }

    } catch (err) {
      console.error("Error watching notifications:", err);
      log("Recovering — navigating back to notifications...");
      await notificationSource.getTweets(page, navigator);
      await page.waitForTimeout(5000);
    }

    // ============================================================
    // PHASE 2: PROCESS QUEUE — reply to highest-priority first
    // ============================================================
    while (queueSize() > 0 && stats.posted < DAILY_LIMIT) {
      const item = peek();
      if (!item) break;

      // Only process items that are "ready" or "pending"
      if (item.status === "pending") {
        updateItem(item.id, { status: "drafting" });

        try {
          // ============================================================
          // PHASE 3: OPEN NOTIFICATION TWEET (before AI generation)
          // ============================================================
          log(`=== PHASE: OPEN TWEET ${item.id} ===`);
          stats.tweets++;

          // Check if already replied BEFORE opening the tweet
          if (hasNotificationReplied(item.id)) {
            log(`Already replied to ${item.id}. Skipping.`);
            dequeue();
            continue;
          }

          // Save scroll position before opening tweet
          const currentScrollY = await page.evaluate(() => window.scrollY);
          setScrollY(currentScrollY);

          await navigator.openTweet(item.url);

          // Skip if we can't reply
          const replyButton = page.locator('[data-testid="reply"]').first();
          if (!(await replyButton.isVisible().catch(() => false))) {
            log(`Reply unavailable. Skipping.`);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          const details = await extractCurrentTweet(page);
          if (!details) {
            log(`Cannot extract tweet ${item.id}. Skipping.`);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // Check if @unfairleverage has already replied manually.
          if (await hasManualReply(page)) {
            log(`Already replied to ${item.id} manually. Skipping.`);
            // Mark as replied in the database to prevent future checks
            markNotificationReplied(item.id);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // ============================================================
          // Check if @unfairleverage is allowed to reply to this post.
          // X shows different signals for restricted replies:
          // - Reply button is greyed out / disabled
          // - "You can't reply" message is visible
          // - "You're unable to reply" toast or notice
          // - Only verified accounts / people @mentioned can reply
          // ============================================================
          const canReply = await page.evaluate(() => {
            const replyBtn = document.querySelector('[data-testid="reply"]');
            // No reply button at all — can't reply
            if (!replyBtn) return false;
            // Button has disabled attribute or aria-disabled
            if (replyBtn.hasAttribute('disabled') || replyBtn.getAttribute('aria-disabled') === 'true') return false;
            // Check for "You can't reply" text near the button or in the conversation
            const disabledTexts = document.querySelectorAll('span, div');
            for (const el of disabledTexts) {
              const text = el.textContent?.trim() || '';
              if (text.includes("can't reply") || text.includes("unable to reply") || text.includes("You can't") || text.includes("replies are limited") || text.includes("only people")) {
                return false;
              }
            }
            return true;
          }) as boolean;
          if (!canReply) {
            log(`Cannot reply to ${item.id} — replies are restricted. Skipping.`);
            await navigator.returnToTimeline();
            dequeue();
            continue;
          }

          // ============================================================
          // Image gate — pause and ask before letting AI touch a tweet
          // that has an image, since images carry context an LLM can miss.
          // SKIP_IMAGE_TWEETS auto-skips any image tweet (the text-length
          // exception is commented out below).
          // Poster overrides (see posterProfiles.ts) bypass this gate
          // entirely — always straight to ChatGPT, image or no image.
          // ============================================================
          const posterHandle = details.handle || item.author;
          const hasImages = Boolean(details.imageUrls && details.imageUrls.length > 0);
          const isOverridePoster = alwaysSendToChatGPT(posterHandle);

          if (hasImages && isOverridePoster) {
            log(`Tweet ${item.id} from ${posterHandle} has image(s) — poster override, sending straight to ChatGPT.`);
          }

          if (hasImages && !isOverridePoster) {
            // const tweetContext = details.fullText || details.text || item.text || "";
            if (SKIP_IMAGE_TWEETS /* && tweetContext.length <= 30 */) {
              log(`Tweet ${item.id} has image(s) — SKIP_IMAGE_TWEETS is on, skipping.`);
              await navigator.returnToTimeline();
              dequeue();
              continue;
            }

            log(`=== TWEET ${item.id} HAS IMAGE(S) — PAUSING FOR REVIEW ===`);
            playNotificationSound();

            const decision = await promptImageDecision(
              details.handle || item.author,
              details.fullText || details.text || item.text,
              details.imageUrls.length
            );

            if (decision === "myself") {
              const manualReply = readlineSync.question(
                chalk.cyan("\nType your reply and press Enter to post it (leave blank if you'd rather type it directly in the browser): ")
              ).trim();

              if (manualReply) {
                // Post what was typed at the prompt, same path the automated flows use
                const { prepareReply, clickReply } = await import("./reply/reply");
                try {
                  await prepareReply(page, manualReply);
                  const success = await clickReply(page, details.handle || item.author);
                  if (success) {
                    markReplied(item.id);
                    markNotificationReplied(item.id);
                    stats.posted++;
                    try {
                      const { MemoryRepository } = await import("./database/MemoryRepository");
                      const memoryRepo = new MemoryRepository();
                      await memoryRepo.saveMemory({
                        id: "",
                        tweetId: item.id,
                        tweetText: details.fullText || details.text || item.text,
                        authorHandle: details.handle || item.author,
                        relationship: item.relationship || "stranger",
                        aiDraft: "manual",
                        finalReply: manualReply,
                        wasEdited: false,
                        approved: true,
                        createdAt: new Date()
                      });
                    } catch {}
                    log(`Manual reply posted for ${item.id}.`);
                  } else {
                    log(`Failed to post manual reply for ${item.id}.`);
                  }
                } catch (err) {
                  console.error(`Failed to post manual reply for ${item.id}:`, err);
                }
              } else {
                // No text typed — assume they'll reply directly in the browser UI
                console.log(chalk.cyan("Reply to it directly in the browser now."));
                readlineSync.question(chalk.cyan("Press Enter once you've replied (or to skip)...\n"));

                if (await hasManualReply(page)) {
                  log(`Manual reply detected for ${item.id}.`);
                  markReplied(item.id);
                  markNotificationReplied(item.id);
                  stats.posted++;
                } else {
                  log(`No manual reply detected for ${item.id}. Skipping.`);
                }
              }

              await navigator.returnToTimeline();
              dequeue();
              continue;
            }

            log(`Passing image tweet ${item.id} to ChatGPT for an automated reply.`);
          }

          // Reading time — scales with fatigue
          const tweetText = details.fullText || details.text || item.text;
          const readTime = getReadingTime(tweetText);
          await page.waitForTimeout(readTime);

          const { MemoryRepository } = await import("./database/MemoryRepository");
          const memoryRepo = new MemoryRepository();
          const memories = await memoryRepo.getRecentMemories(20);

          // Micro-break before drafting — scales with fatigue
          const microBreak = getMicroBreak();
          if (microBreak > 0) {
            await page.waitForTimeout(microBreak);
          }

          // Determine tweet type to decide which model to use
          const tweetType = classifyTweet(tweetText);
          
          let reply = "";
          // Use Ollama for greetings/well-wishes to save ChatGPT API calls
          if (tweetType === "well_wish" || tweetType === "greeting") {
            for (let i = 0; i < 3; i++) {
              reply = await generateOllamaReply(tweetText);
              if (validateReply(reply) && !isDuplicate(reply)) {
                break;
              }
            }
          } else {
            // Use ChatGPT for other tweet types
            for (let i = 0; i < 3; i++) {
              try {
                reply = await chatgpt.generateReply({
                  tweet: tweetText,
                  relationship: "stranger",
                  memories
                });
                if (validateReply(reply) && !isDuplicate(reply)) {
                  break;
                }
              } catch (err) {
                log(`ChatGPT attempt ${i + 1} failed: ${err}`);
                reply = ""; // Reset reply on error
              }
            }
          }

          if (!reply || !validateReply(reply)) {
            log(`Failed to generate valid reply for ${item.id}. Skipping.`);
            await navigator.returnToTimeline();
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

      // Use the same item that was just set to "ready" — don't re-peek
      // because peek() returns the highest-scored item, and another
      // higher-scored item that's still "pending" could jump ahead.
      if (item.status !== "ready") {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      updateItem(item.id, { status: "processing" });

      try {
        // Re-extract tweet details (the page is still open from the pending phase)
        const details = await extractCurrentTweet(page);
        if (!details) {
          log(`Cannot extract tweet ${item.id}. Skipping.`);
          await navigator.returnToTimeline();
          dequeue();
          continue;
        }

        // Reading time — scales with fatigue
        const tweetText = details.fullText || details.text || item.text;
        const readTime = getReadingTime(tweetText);
        await page.waitForTimeout(readTime);

        // Thinking time — scales with fatigue
        const thinkTime = getThinkingTime();
        if (thinkTime > 0) {
          await page.waitForTimeout(thinkTime);
        }

        // Determine tweet type
        const tweetType = classifyTweet(tweetText);
        const isAutoPost = tweetType === "well_wish";

        if (isAutoPost) {
          // ============================================================
          // PHASE 4a: AUTO-POST (greeting or well-wish)
          // ============================================================
          const autoLabel = "well-wish";
          log(`=== AUTO-POST ${autoLabel.toUpperCase()} ===`);
          console.log(`\n🤖 Auto-replying to ${autoLabel}: "${tweetText}"\n`);

          const { prepareReply, clickReply } = await import("./reply/reply");
          const memoryRepo = new (await import("./database/MemoryRepository")).MemoryRepository();
          const memories = await memoryRepo.getRecentMemories(20);

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

          // Use Ollama for greetings to save ChatGPT API calls
          const autoDraft = await generateOllamaReply(tweetText);

          if (autoDraft) {
            try {
              await prepareReply(page, autoDraft);
              const success = await clickReply(page, details.handle || item.author);
              if (success) {
                try {
                  await memoryRepo.saveMemory({
                    id: "",
                    tweetId: item.id,
                    tweetText,
                    authorHandle: details.handle || item.author,
                    relationship: item.relationship || "stranger",
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

          markReplied(item.id);
          markNotificationReplied(item.id);
          dequeue();
          stats.posted++;

          const progress = getNotificationProgress();
          const remaining = progress.total - progress.replied;
          console.log(`\n✅ ${autoLabel} reply posted. Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)\n`);
        } else {
          // ============================================================
          // PHASE 4b: AUTO-POST (ChatGPT draft)
          // ============================================================
          log(`=== AUTO-POST (ChatGPT) ===`);
          console.log(`\n${chalk.green("🤖 ChatGPT draft for @" + (details.handle || item.author))}:\n`);
          console.log(chalk.yellow(`   ┌─ Tweet ─────────────────────────────────────`));
          console.log(chalk.yellow(`   │ ${tweetText}`));
          console.log(chalk.green(`   ├─ Draft ─────────────────────────────────────`));
          console.log(chalk.green(`   │ ${item.draft}`));
          console.log(chalk.green(`   └─────────────────────────────────────────────\n`));

          const { prepareReply, clickReply } = await import("./reply/reply");
          const memoryRepo = new (await import("./database/MemoryRepository")).MemoryRepository();

          try {
            await prepareReply(page, item.draft!);
            const success = await clickReply(page, details.handle || item.author);
            if (success) {
              try {
                await memoryRepo.saveMemory({
                  id: "",
                  tweetId: item.id,
                  tweetText,
                  authorHandle: details.handle || item.author,
                  relationship: item.relationship || "stranger",
                  aiDraft: item.draft || "",
                  finalReply: item.draft || "",
                  wasEdited: false,
                  approved: true,
                  createdAt: new Date()
                });
                console.log(`🧠 Saved to memory.\n`);
              } catch {}
            }
          } catch (err) {
            console.error(`Failed to auto-post:`, err);
          }

          markReplied(item.id);
          markNotificationReplied(item.id);
          dequeue();
          stats.posted++;

          const progress = getNotificationProgress();
          const remaining = progress.total - progress.replied;
          console.log(`\n✅ Reply posted. Progress: ${progress.replied}/${progress.total} replied (${remaining} remaining)\n`);
        }

        // ============================================================
        // PHASE 5: RETURN TO NOTIFICATIONS + pause
        // ============================================================
        log(`=== PHASE: RETURN TO NOTIFICATIONS ===`);
        await notificationSource.returnToPostsFeed(navigator);

        // Restore scroll position after returning
        const savedScrollY = getScrollY();
        if (savedScrollY > 0) {
          await page.evaluate((y) => window.scrollTo(0, y), savedScrollY);
          log(`Restored scroll position to ${savedScrollY}px`);
        }

        // Post-reply pause — scales with fatigue
        const postPause = getPostReplyPause();
        if (postPause > 0) {
          await page.waitForTimeout(postPause);
        }

        // Occasional interruption — scales with fatigue
        const interruption = maybeInterruption();
        if (interruption > 0) {
          log(`Interruption — ${(interruption / 1000).toFixed(0)}s pause...`);
          await page.waitForTimeout(interruption);
        }

        // Re-rank queue — other notifications may have aged
        reRankQueue();

        // Check for new notifications between each reply
        try {
          if (!(await isLoggedIn(page))) {
            log("Session expired. Stopping bot.");
            break;
          }
          console.log("  → Checking for new notifications...");
          const freshTweets = await notificationSource.getTweets(page, navigator, true);
          if (freshTweets.length > 0) {
            const replyRatio2 = getReplyRatio();
            for (const ft of freshTweets) {
              if (hasReplied(ft.id)) continue;
              const existing2 = getQueue().find((q: QueueItem) => q.id === ft.id);
              if (existing2) continue;
              if (Math.random() > replyRatio2) continue;
              markNotificationSeen(ft.id, ft.url);
              enqueue({ id: ft.id, url: ft.url, author: ft.author, text: ft.text, createdAt: Date.now(), status: "pending" }, ft);
            }
            reRankQueue();
            console.log(`  ✓ +${freshTweets.length} new, queue: ${queueSize()}`);
          }
        } catch {
          // Non-critical — continue processing queue
        }

      } catch (err) {
        log(`Cannot reply to tweet ${item.id}. Skipping.`);
        await notificationSource.returnToPostsFeed(navigator);
        dequeue();
      }
    }
  }

  clearInterval(watchdog);
  log(`Completed ${stats.posted} replies today.`);
  await chatgpt.close();
}

main().catch(console.error);