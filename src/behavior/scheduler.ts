export function isActiveHours(): boolean {
  const hour = new Date().getHours();
  
  // Active hours: 9 AM - 12 PM, 2 PM - 6 PM, 8 PM - 10 PM
  return (
    (hour >= 9 && hour < 12) ||
    (hour >= 14 && hour < 18) ||
    (hour >= 20 && hour < 22)
  );
}

export function shouldTakeBreak(replyCount: number): boolean {
  const repliesBeforeBreak = 20 + Math.random() * 15;
  return replyCount >= repliesBeforeBreak;
}

export function getBreakDuration(): number {
  // 10-30 minutes in milliseconds
  return (10 + Math.random() * 20) * 60 * 1000;
}

/**
 * Decide whether to take a random break after a reply.
 * ~20% chance per reply. Break duration: 1 minute to 1 hour.
 * Returns 0 if no break should be taken.
 */
export function maybeBreakAfterReply(): number {
  // ~20% chance to trigger a break
  if (Math.random() > 0.2) return 0;

  // 1 minute to 1 hour in milliseconds
  return (60_000 + Math.random() * 3_540_000);
}

/**
 * Decide whether to quit instead of taking a break.
 * ~50% chance when a break is triggered.
 * If true, the app logs the message and exits so you can restart later.
 */
export function shouldQuitInsteadOfBreak(): boolean {
  return Math.random() < 0.5;
}