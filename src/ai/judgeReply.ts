import ollama from "ollama";

export interface Score {
  name: string;
  score: number; // 1-10
}

export interface JudgedReply {
  reply: string;
  scores: Score[];
  total: number;
}

/**
 * Step 4: Judge a reply's quality before showing it to the user.
 * 
 * Scores multiple dimensions and picks the best one.
 */
export async function judgeReplies(
  tweet: string,
  replies: string[]
): Promise<JudgedReply[]> {
  const results: JudgedReply[] = [];

  for (const reply of replies) {
    const response = await ollama.chat({
      model: "gpt-oss:20b",
      options: {
        temperature: 0.2, // Low temp for consistent scoring
      },
      messages: [
        {
          role: "system",
          content: `
You are judging reply quality for X (Twitter).

Score this reply on 4 dimensions.

Return JSON only.

{
  "relevance": 0,
  "humor": 0,
  "naturalness": 0,
  "originality": 0
}

Each score is 1-10.

- relevance: does it actually respond to the tweet?
- humor: is it witty or funny? (even for serious tweets, a light touch counts)
- naturalness: does it sound like a human wrote it?
- originality: is it creative or just repeating the tweet?

Output ONLY the JSON.
`
        },
        {
          role: "user",
          content: `
Tweet: ${tweet}

Reply: ${reply}

Score this reply.
`
        }
      ]
    });

    try {
      const scores = JSON.parse(response.message.content.trim()) as Record<string, number>;
      const scoreList: Score[] = [
        { name: "relevance", score: scores.relevance ?? 5 },
        { name: "humor", score: scores.humor ?? 5 },
        { name: "naturalness", score: scores.naturalness ?? 5 },
        { name: "originality", score: scores.originality ?? 5 },
      ];
      const total = scoreList.reduce((sum, s) => sum + s.score, 0);
      results.push({ reply, scores: scoreList, total });
    } catch {
      results.push({
        reply,
        scores: [
          { name: "relevance", score: 5 },
          { name: "humor", score: 5 },
          { name: "naturalness", score: 5 },
          { name: "originality", score: 5 },
        ],
        total: 20,
      });
    }
  }

  // Sort by total score descending
  results.sort((a, b) => b.total - a.total);

  return results;
}