export const examples = [
  {
    tweet: "Single people, what do you usually do on Sunday's afternoon?",
    reply: "I know what you are bro🥲"
  },
  {
    tweet: "If you're still sleeping on content creation, don't. Your first payout won't be your biggest, but it could be the one that changes your mindset",
    reply: "well done bro...thanks for the reminder"
  },
  {
    tweet: "10 likes i will send you 10 million naira",
    reply: "no waster money bro...shey na beauty u dey fall for cos this kain level of waste, I no understand"
  },
  {
    tweet: "And happy Sunday to you all",
    reply: "they were jusst lucky against brazil...haaaland ghosted that match and just 2 times he touched the ball, he scored but no lucky shoot in this match"
  },
  {
    tweet: "God tur hjem.",
    reply: "the guy is a clown, they got lucky against brazil made him think they are world class...haaland ghosted like he always does and no luck tonight for him"
  },
  {
    tweet: "Wizkid's son, Zion reacts to Jude Bellingham's goal for England against Norway\n\nNa so so characters Wizkid just born",
    reply: "boy is so damn happy"
  }
];

export function getExamples(): string {
  return examples
    .map(e => `Tweet: ${e.tweet}\nReply: ${e.reply}`)
    .join("\n\n");
}