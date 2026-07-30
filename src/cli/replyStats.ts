import "dotenv/config";
import { getReplyCountsPerHour, getCurrentHourReplyCount } from "../storage/hourlyReplyStats";

async function main() {
  const counts = await getReplyCountsPerHour();
  const currentHour = await getCurrentHourReplyCount();

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

  process.exit(0);
}

main().catch((err) => {
  console.error("[ReplyStats] Fatal error:", err);
  process.exit(1);
});
