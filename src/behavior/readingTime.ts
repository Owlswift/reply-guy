export function estimateReadingTime(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.max(2000, words * 250);
}