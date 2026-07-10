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