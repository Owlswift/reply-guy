export function validateReply(reply: string): boolean {
  const trimmed = reply.trim();

  if (trimmed.toLowerCase().startsWith("certainly")) return false;
  if (trimmed.toLowerCase().startsWith("sure")) return false;
  if (trimmed.length < 5) return false;
  if (trimmed.length > 270) return false;

  return true;
}