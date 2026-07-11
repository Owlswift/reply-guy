const seenTweetIds = new Set<string>();

let stagnantRounds = 0;

export function updateTimeline(tweetIds: string[]): void {
  const before = seenTweetIds.size;

  for (const id of tweetIds) {
    seenTweetIds.add(id);
  }

  const after = seenTweetIds.size;

  if (after === before) {
    stagnantRounds++;
  } else {
    stagnantRounds = 0;
  }
}

export function hasSeenTweet(id: string): boolean {
  return seenTweetIds.has(id);
}

export function timelineLooksStuck(): boolean {
  return stagnantRounds >= 3;
}

export function resetTimelineState(): void {
  stagnantRounds = 0;
}
