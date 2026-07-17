import { exec } from "child_process";

const NOTIFICATION_LOOP_INTERVAL_MS = 4000;

/**
 * Play an attention sound so a paused/waiting-for-input moment isn't missed.
 * Falls back to the terminal bell on non-macOS platforms.
 */
export function playNotificationSound(): void {
  if (process.platform === "darwin") {
    // -v 1 is afplay's own max playback volume.
    exec("afplay -v 1 /System/Library/Sounds/Glass.aiff", () => {});
  } else {
    process.stdout.write("\x07");
  }
}

// Push system output volume up so the loop below can't be missed even if
// the machine's volume was turned down. Best-effort — ignored on failure
// (e.g. non-macOS, or volume controlled by hardware).
function boostSystemVolume(): void {
  if (process.platform === "darwin") {
    exec('osascript -e "set volume output volume 100"', () => {});
  }
}

/**
 * Repeatedly plays the notification sound every `intervalMs` until stopped —
 * used while blocked on manual input so a paused prompt is never missed.
 * Call the returned function once input is received to stop the loop.
 */
export function startNotificationLoop(
  intervalMs: number = NOTIFICATION_LOOP_INTERVAL_MS
): () => void {
  boostSystemVolume();
  playNotificationSound();
  const timer = setInterval(playNotificationSound, intervalMs);
  return () => clearInterval(timer);
}
