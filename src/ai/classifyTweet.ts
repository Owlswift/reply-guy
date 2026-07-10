export type TweetType =
  | "question"
  | "technical"
  | "announcement"
  | "humor"
  | "personal"
  | "news"
  | "general";

export function classifyTweet(text: string): TweetType {
  const t = text.toLowerCase();

  if (t.includes("?"))
    return "question";

  if (
    t.includes("api") ||
    t.includes("react") ||
    t.includes("typescript") ||
    t.includes("javascript") ||
    t.includes("docker") ||
    t.includes("ai")
  )
    return "technical";

  if (
    t.includes("released") ||
    t.includes("launch") ||
    t.includes("announcing")
  )
    return "announcement";

  if (
    t.includes("😂") ||
    t.includes("🤣") ||
    t.includes("lol")
  )
    return "humor";

  if (
    t.includes("today") ||
    t.includes("family") ||
    t.includes("wife") ||
    t.includes("mum") ||
    t.includes("mom")
  )
    return "personal";

  return "general";
}