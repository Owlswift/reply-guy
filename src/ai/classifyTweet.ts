export type TweetType =
  | "question"
  | "technical"
  | "announcement"
  | "humor"
  | "personal"
  | "news"
  | "general"
  | "greeting"
  | "well_wish";

export function classifyTweet(text: string): TweetType {
  const t = text.toLowerCase();

  // Well-wish detection — auto-reply without intervention
  // Catches: "happy sunday", "it's sunday", "sunday morning", "blessed sunday", "happy new week", "happy monday", etc.
  if (
    t.includes("happy sunday") ||
    t.includes("happy new week") ||
    t.includes("happy weekend") ||
    t.includes("happy monday") ||
    t.includes("happy tuesday") ||
    t.includes("happy wednesday") ||
    t.includes("happy thursday") ||
    t.includes("happy friday") ||
    t.includes("happy saturday") ||
    // Also catch "it's sunday", "it's monday" etc.
    /it's (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/.test(t) ||
    // Catch "sunday morning", "sunday evening", etc.
    /(sunday|monday) (morning|afternoon|evening|night)/.test(t) ||
    // Catch day-of-week + blessing patterns like "blessed sunday", "grace sunday"
    /(blessed|grace|happy|thank).*\b(sunday|monday)\b/.test(t)
  )
    return "well_wish";

  // Greeting detection — respond with a simple greeting back
  if (
    t.includes("good morning") ||
    t.includes("good afternoon") ||
    t.includes("good evening") ||
    t === "morning" ||
    t.startsWith("morning ") ||
    t.includes(" gm ") ||
    t.startsWith("gm")
  )
    return "greeting";

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
