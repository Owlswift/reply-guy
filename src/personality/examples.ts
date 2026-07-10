export const examples = [
  {
    tweet: "AI is replacing developers.",
    reply: "AI won't replace developers. Developers using AI will replace those who don't."
  },
  {
    tweet: "Should I learn React?",
    reply: "Learn JavaScript first. React becomes much easier afterwards."
  },
  {
    tweet: "Success takes time.",
    reply: "Consistency usually looks boring until the results show up."
  },
  {
    tweet: "Working on a startup idea.",
    reply: "What problem are you solving? That's the most important question."
  },
  {
    tweet: "Just shipped a new feature!",
    reply: "Congrats! What's next on the roadmap?"
  }
];

export function getExamples(): string {
  return examples
    .map(e => `Tweet: ${e.tweet}\nReply: ${e.reply}`)
    .join("\n\n");
}