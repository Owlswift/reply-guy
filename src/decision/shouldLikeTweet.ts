import { TimelineTweet } from "../types/tweet";
import { log } from "../utils/logger";

/**
 * Independent "would I genuinely like this" judgment for every tweet
 * startSearch.ts sees while scrolling — decoupled from the story-teller
 * push/skip decision entirely, so liking isn't just "whatever failed the
 * other filter." Runs once per visible tweet on every scroll batch, so a
 * browser-automated ChatGPT.com round trip (15-50s) would be far too slow —
 * uses the local Ollama model instead, same as engage/classifyReply.ts.
 */
const OLLAMA_URL = "http://localhost:11434/api/generate";

const LIKE_PROMPT = `You are deciding whether to like a post on X (Twitter) while casually scrolling through your feed — not whether to reply to it.

You genuinely enjoy: real personal stories, political/social commentary with a clear point of view, opinion or motivational posts that say something real (not generic platitudes), and trading/business/educational content with actual substance.

You are NOT impressed by: bare engagement bait, low-effort memes, generic "good morning" / follow-for-follow posts, spam, ragebait with no real point, or anything that's just noise.

Most posts get scrolled past without a like — a real person doesn't like everything they see. Only like something if it actually resonated: made you think, feel something, or taught you something.

Post by @{{author}}: "{{text}}"

Answer with exactly one word: LIKE or SKIP.`;

export async function shouldLikeTweet(tweet: TimelineTweet): Promise<boolean> {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-oss:20b",
        stream: false,
        prompt: LIKE_PROMPT.replace("{{author}}", tweet.username).replace("{{text}}", tweet.text),
        options: {
          temperature: 0.3,
          top_p: 0.9,
        },
      }),
    });

    const data = (await response.json()) as { response: string };
    const raw = data.response.trim().toUpperCase();
    return raw.includes("LIKE") && !raw.includes("SKIP");
  } catch (err) {
    log(`[ShouldLike] Ollama unavailable, defaulting to skip: ${err}`);
    return false;
  }
}
