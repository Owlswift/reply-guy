let lastRefresh = Date.now();

export function shouldRefreshSession(): boolean {
  const elapsed = Date.now() - lastRefresh;

  const limit =
    (20 + Math.random() * 20) * 60 * 1000;

  return elapsed > limit;
}

export function markSessionRefreshed(): void {
  lastRefresh = Date.now();
}