const previousReplies = new Set<string>();

export function isDuplicate(reply: string): boolean {
  const key = reply.toLowerCase().trim();

  if (previousReplies.has(key)) {
    return true;
  }

  previousReplies.add(key);
  return false;
}

export function clearDuplicates(): void {
  previousReplies.clear();
}