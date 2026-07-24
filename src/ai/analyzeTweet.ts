import ollama from "ollama";

/**
 * Two-step analysis:
 * 1. Classify the tweet type using keyword rules (fast, no model call)
 * 2. Analyze tone, core point, and best reply style using the model (only for certain types)
 */
export interface TweetAnalysis {
  type: "humor" | "story" | "opinion" | "question" | "news" | "advice" | "politics" | "sports" | "career" | "meme" | "general";
  tone: "lighthearted" | "serious" | "sarcastic" | "inspirational" | "controversial" | "neutral";
  main_point: string;
  best_reply_style: "extend" | "observe" | "question" | "add_perspective" | "react";
  // Only meaningful when a quoted tweet was actually passed in — the
  // author's stance toward the tweet they're quoting. Without this, a
  // reply can easily agree with something the author was actually mocking,
  // or vice versa: "this generation is cooked" reads completely differently
  // agreeing with vs. mocking "my girlfriend bought me a car for my birthday".
  quote_stance: "agreeing" | "disagreeing" | "mocking" | "adding_context" | "asking_question" | "using_as_example" | "not_applicable";
}

export interface TweetContext {
  // The tweet embedded/quoted by the current tweet (a genuine quote of
  // someone ELSE's tweet — not a same-author "show this thread" preview).
  quotedTweet?: string;
  // The tweet this one is directly replying to, when that's a different
  // author — i.e. this tweet only makes sense as one side of a conversation.
  parentTweet?: string;
  // An earlier segment of the SAME author's own thread that led into this
  // tweet, distinct from parentTweet (a reply to someone else).
  previousThreadPost?: string;
}

/**
 * Analyze a tweet to understand its structure and intent.
 * Uses the model for deeper understanding of tone and reply strategy.
 *
 * `context` carries whatever surrounding tweet(s) extractTweet.ts found —
 * a quoted tweet, a parent tweet in a reply chain, or an earlier segment of
 * the author's own thread. Without this, the model only ever sees the
 * current tweet in isolation, so something like "this generation is cooked"
 * gets analyzed identically whether it's a standalone opinion or a reaction
 * quoting "my girlfriend bought me a car for my birthday" — two completely
 * different tweets that happen to share the same visible text.
 */
export async function analyzeTweet(tweet: string, context: TweetContext = {}): Promise<TweetAnalysis> {
  const contextLines: string[] = [];
  if (context.parentTweet) {
    contextLines.push(`This tweet is a REPLY to someone else's tweet. What it's replying to:\n${context.parentTweet}`);
  }
  if (context.previousThreadPost) {
    contextLines.push(`This tweet continues the SAME author's own earlier thread. The tweet right before it:\n${context.previousThreadPost}`);
  }
  if (context.quotedTweet) {
    contextLines.push(`This tweet QUOTES another tweet. The quoted tweet:\n${context.quotedTweet}`);
  }
  const contextBlock = contextLines.length > 0 ? `\n\nContext:\n\n${contextLines.join("\n\n")}\n` : "";

  const response = await ollama.chat({
    model: "gpt-oss:20b",
    options: {
      temperature: 0.3, // Lower temp for more consistent analysis
    },
    messages: [
      {
        role: "system",
        content: `
You are analyzing a tweet to help an AI write a good reply.

Output ONLY valid JSON with this structure:

{
  "type": "humor|story|opinion|question|news|advice|politics|sports|career|meme|general",
  "tone": "lighthearted|serious|sarcastic|inspirational|controversial|neutral",
  "main_point": "one sentence summary of what the tweet is actually saying or the punchline",
  "best_reply_style": "extend|observe|question|add_perspective|react",
  "quote_stance": "agreeing|disagreeing|mocking|adding_context|asking_question|using_as_example|not_applicable"
}

Rules:

- type: judge this from the tweet's actual STRUCTURE, not just the topic it happens to mention. If the tweet narrates a sequence of events as an anecdote — something happened, then something else happened, building toward an ending or a punchline — it's "story", even if the subject matter is a job, politics, sports, etc. Do NOT classify a narrated anecdote as "career"/"politics"/"sports" just because it mentions a job, a politician, or a game — only use those categories when the tweet is stating an opinion, take, or fact about that topic, not telling a story about it.
- tone: the emotional tone
- main_point: the actual message, joke, or hidden point — read it TOGETHER with any quoted/parent/previous-thread context below, not in isolation. The same words can mean opposite things depending on what they're reacting to (e.g. "this generation is cooked" mocking someone's bad take reads nothing like "this generation is cooked" agreeing that a girlfriend buying a car is a red flag).
- best_reply_style: how to reply:
  - extend: continue the joke or idea
  - observe: react naturally as a friend would
  - question: ask a follow-up if appropriate
  - add_perspective: offer another angle
  - react: express a genuine reaction
- quote_stance: ONLY set this to something other than "not_applicable" if a quoted tweet is actually given below. If there is one, determine whether the author is agreeing with it, disagreeing with it, mocking it, adding context to it, asking a genuine question about it, or just using it as an example to make an unrelated point. Getting this wrong is how a reply ends up agreeing with something the author was actually criticizing, or vice versa.
`
      },
      {
        role: "user",
        content: `Tweet: ${tweet}${contextBlock}`
      }
    ]
  });

  try {
    return JSON.parse(response.message.content.trim()) as TweetAnalysis;
  } catch {
    // Fallback if JSON parsing fails
    return {
      type: "general",
      tone: "lighthearted",
      main_point: tweet,
      best_reply_style: "react",
      quote_stance: "not_applicable"
    };
  }
}