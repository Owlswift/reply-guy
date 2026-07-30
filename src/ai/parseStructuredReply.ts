export interface ParsedReply {
  understanding: string | null;
  reply: string;
}

/**
 * Lowercases the first character of a reply — a mechanical backstop for
 * prompt.ts's "never capitalize the first letter" instruction, same
 * reasoning as validator.ts's em-dash rejection: the prompt asks nicely,
 * but that's not reliably followed on its own, so this guarantees it
 * instead of trusting the instruction alone.
 */
export function lowercaseFirstLetter(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Splits a raw AI response into its "INTERNAL CONTEXT" checklist (Premise/
 * Tone/Reply direction) and "REPLY:" text (prompt.ts's OUTPUT FORMAT
 * instruction, part of the Stage 1-understand/Stage 2-write structure) —
 * lets callers log what the model concluded before writing, for a human to
 * actually assess it, without that checklist ever being posted as part of
 * the reply itself. Finds the "REPLY:" marker anywhere in the text and
 * takes everything after it as the reply, regardless of what (if anything)
 * precedes it — NOT anchored to "preceded by a newline". The model doesn't
 * always emit the INTERNAL CONTEXT checklist before it; when it skips
 * straight to "REPLY: ..." as the very first thing in the response, there
 * is no newline before the marker at all, and a regex requiring one
 * (`^([\s\S]*?)\n\s*REPLY:`) fails to match — falling back to posting the
 * literal "REPLY: ..." prefix verbatim as part of the reply, which is
 * exactly the bug this exists to prevent.
 *
 * Falls back to treating the whole raw text as the reply if the model
 * didn't include a "REPLY:" marker at all — LLMs don't always follow
 * format instructions exactly, and this must never be the reason a
 * perfectly good reply gets rejected.
 */
export function parseStructuredReply(raw: string): ParsedReply {
  const match = raw.match(/REPLY:\s*([\s\S]*)/i);
  if (match && match[1]!.trim()) {
    const understanding = raw.slice(0, match.index).trim();
    return { understanding: understanding || null, reply: lowercaseFirstLetter(match[1]!.trim()) };
  }
  return { understanding: null, reply: lowercaseFirstLetter(raw.trim()) };
}
