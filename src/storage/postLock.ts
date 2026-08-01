import { randomUUID } from "crypto";
import { getRedisClient } from "./redis";
import { log } from "../utils/logger";

/**
 * A cross-process turnstile around the actual moment of posting a reply —
 * NOT a dispatcher/queue. Every script (main-interactive.ts, notifications/
 * engage.ts, catchup:priority, catchup:stories) still decides its own
 * content and timing entirely independently; this only makes sure two of
 * them never click "reply" within the same few seconds of each other,
 * which is exactly the kind of clustered-timestamp pattern that reads as
 * automated. reply/reply.ts's clickReply() is the one function every
 * posting path already funnels through (same reasoning
 * storage/hourlyReplyStats.ts's centralized recording relies on), so that's
 * the single place this needs to be wired in.
 *
 * Flow: acquirePostLock() blocks until no other process is mid-post AND at
 * least POST_COOLDOWN_MS has passed since the last post finished anywhere,
 * then holds the lock. releasePostLock() frees it and starts the next
 * cooldown window.
 */

const LOCK_KEY = "echo:post_lock";
const LAST_RELEASED_KEY = "echo:post_lock:last_released_at";

// Safety-net TTL on the lock itself — if a process crashes mid-post
// (browser crash, killed process) between acquire and release, this is
// what stops every other script from being permanently blocked. Posting
// (typing is already done before this point — see clickReply()) takes
// seconds, not tens of seconds, so this has real margin without leaving a
// stale lock around for long if something does go wrong.
const LOCK_TTL_MS = 30_000;

// Minimum gap enforced between one process finishing a post and the next
// one (anywhere) starting its own.
const POST_COOLDOWN_MS = 10_000;

const POLL_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tracks this process's own current lock ownership — safe as a module-level
// variable since each script is a separate OS process with its own memory;
// this never needs to be shared across processes, only across
// acquire/release calls within the same one.
let heldToken: string | null = null;

/**
 * Block until it's this process's turn to post, then hold the lock until
 * releasePostLock() is called. Fails open (returns immediately) if Redis
 * is unreachable — losing this coordination for one post is far better
 * than the whole bot stalling because Redis hiccuped.
 */
export async function acquirePostLock(): Promise<void> {
  const redis = getRedisClient();
  const token = randomUUID();
  let loggedWaiting = false;

  while (true) {
    let lastReleased: string | null;
    try {
      lastReleased = await redis.get(LAST_RELEASED_KEY);
    } catch (err) {
      log(`[PostLock] Redis unreachable, proceeding without coordination: ${err}`);
      return;
    }

    if (lastReleased) {
      const remaining = POST_COOLDOWN_MS - (Date.now() - parseInt(lastReleased, 10));
      if (remaining > 0) {
        if (!loggedWaiting) {
          log(`[PostLock] Cooling down ${Math.ceil(remaining / 1000)}s after the last post (this or another script) before posting.`);
          loggedWaiting = true;
        }
        await sleep(Math.min(remaining, POLL_INTERVAL_MS));
        continue;
      }
    }

    let acquired: "OK" | null;
    try {
      acquired = await redis.set(LOCK_KEY, token, "PX", LOCK_TTL_MS, "NX");
    } catch (err) {
      log(`[PostLock] Redis unreachable, proceeding without coordination: ${err}`);
      return;
    }

    if (acquired === "OK") {
      heldToken = token;
      return;
    }

    if (!loggedWaiting) {
      log("[PostLock] Another script is posting right now — waiting for it to finish...");
      loggedWaiting = true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Release the lock this process is holding (a no-op if it isn't holding
 * one) and start the next cooldown window. Uses a check-then-delete Lua
 * script so a lock that already expired and was re-acquired by someone
 * else in the meantime never gets deleted out from under them.
 */
export async function releasePostLock(): Promise<void> {
  if (!heldToken) return;
  const token = heldToken;
  heldToken = null;

  const redis = getRedisClient();
  try {
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      LOCK_KEY,
      token
    );
    await redis.set(LAST_RELEASED_KEY, Date.now().toString());
  } catch (err) {
    log(`[PostLock] Failed to release cleanly (will auto-expire): ${err}`);
  }
}
