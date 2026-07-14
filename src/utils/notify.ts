import { exec } from "child_process";

/**
 * Play an attention sound so a paused/waiting-for-input moment isn't missed.
 * Falls back to the terminal bell on non-macOS platforms.
 */
export function playNotificationSound(): void {
  if (process.platform === "darwin") {
    exec("afplay /System/Library/Sounds/Glass.aiff", () => {});
  } else {
    process.stdout.write("\x07");
  }
}
