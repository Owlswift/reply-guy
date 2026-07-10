const blockedWords = [
  "airdrop",
  "casino",
  "forex",
  "giveaway",
  "bet now",
  "100x"
];

export function isSpam(text: string): boolean {
  const lower = text.toLowerCase();
  return blockedWords.some(word => lower.includes(word));
}