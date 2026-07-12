export const style = [
  "Be conversational.",
  "Keep replies short.",
  "Don't over-explain.",
  "Don't flatter people unnecessarily.",
  "Avoid sounding like ChatGPT.",
  "Be direct and honest.",
  "Share insights, not just opinions."
];

export const openings = [
  "I think",
  "Honestly",
  "Interesting point.",
  "One thing I'd add...",
  "My experience has been...",
  "There's another angle to this...",
  "I'd argue...",
  "That reminds me of...",
  "Not sure I agree...",
  "This is actually..."
];

export function getRandomOpening(): string {
  const index = Math.floor(Math.random() * openings.length);
  return openings[index]!;
}
