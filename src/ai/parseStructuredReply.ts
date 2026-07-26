export interface ParsedReply {
  understanding: string | null;
  reply: string;
}

/**
 * Splits a raw AI response into its "INTERNAL CONTEXT" checklist (Premise/
 * Tone/Reply direction) and "REPLY:" text (prompt.ts's OUTPUT FORMAT
 * instruction, part of the Stage 1-understand/Stage 2-write structure) —
 * lets callers log what the model concluded before writing, for a human to
 * actually assess it, without that checklist ever being posted as part of
 * the reply itself. Matches everything up to "REPLY:" regardless of the
 * label used above it, so a prompt.ts wording change doesn't silently
 * break this — the only structural requirement is the "REPLY:" marker.
 *
 * Falls back to treating the whole raw text as the reply if the model
 * didn't follow the format — LLMs don't always follow format instructions
 * exactly, and this must never be the reason a perfectly good reply gets
 * rejected. Same behavior as before this existed.
 */
export function parseStructuredReply(raw: string): ParsedReply {
  const match = raw.match(/^([\s\S]*?)\n\s*REPLY:\s*([\s\S]*)/i);
  if (match && match[2]!.trim()) {
    return { understanding: match[1]!.trim(), reply: match[2]!.trim() };
  }
  return { understanding: null, reply: raw.trim() };
}
