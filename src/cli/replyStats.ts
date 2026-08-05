import "dotenv/config";
import { getReplyCountsPerHour, getCurrentHourReplyCount } from "../storage/hourlyReplyStats";
import { getQuotaReplyCountsPerHour } from "../storage/hourlyReplyQuota";
import { getStoryTellerReplyCountsForDay } from "../storage/dailyStoryTellerReplyStats";

async function main() {
  const counts = await getReplyCountsPerHour();
  const currentHour = await getCurrentHourReplyCount();
  const quotaCounts = await getQuotaReplyCountsPerHour();
  const storyHandleCounts = await getStoryTellerReplyCountsForDay();

  console.log("");
  console.log("  ╔═══════════════════════════════════════════╗");
  console.log("  ║     Echo — Replies Per Hour                ║");
  console.log("  ╚═══════════════════════════════════════════╝");
  console.log("");

  if (counts.length === 0) {
    console.log("No replies recorded yet.\n");
    process.exit(0);
  }

  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const maxCount = Math.max(...counts.map(c => c.count));

  for (const { hour, count } of counts) {
    const bar = "█".repeat(Math.max(1, Math.round((count / maxCount) * 30)));
    console.log(`  ${hour}   ${count.toString().padStart(3)}  ${bar}`);
  }

  console.log("");
  console.log("=".repeat(50));
  console.log(`  Total replies logged: ${total}`);
  console.log(`  This hour so far:     ${currentHour}`);
  console.log("=".repeat(50) + "\n");

  console.log("  ╔═══════════════════════════════════════════╗");
  console.log("  ║  Hourly QUOTA Only (1-3/hr scripts)        ║");
  console.log("  ║  main-interactive + catchup:priority/stories║");
  console.log("  ╚═══════════════════════════════════════════╝");
  console.log("");

  if (quotaCounts.length === 0) {
    console.log("No quota-gated replies recorded yet.\n");
  } else {
    const quotaMax = Math.max(...quotaCounts.map((c) => c.count), 1);
    for (const { hour, count } of quotaCounts) {
      const bar = "█".repeat(Math.max(1, Math.round((count / quotaMax) * 30)));
      console.log(`  ${hour}   ${count.toString().padStart(3)}  ${bar}`);
    }
    console.log("");
  }

  console.log("  ╔═══════════════════════════════════════════╗");
  console.log("  ║  Story-Teller Handles — Replies Today      ║");
  console.log("  ╚═══════════════════════════════════════════╝");
  console.log("");

  if (storyHandleCounts.length === 0) {
    console.log("No story-handle replies recorded today.\n");
  } else {
    for (const { handle, count } of storyHandleCounts) {
      console.log(`  @${handle.padEnd(24)} ${count}`);
    }
    console.log("");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[ReplyStats] Fatal error:", err);
  process.exit(1);
});
