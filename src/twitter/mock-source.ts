import { TweetData } from "../types";
import { TweetSource } from "./source";

const SAMPLE_TWEETS: TweetData[] = [
  {
    id: "1",
    tweetId: "1850000000000000001",
    authorId: "12345",
    authorHandle: "tech_startup",
    text: "What's the best way to handle rate limiting in a Node.js API? We're seeing 429s from our external provider and it's killing our user experience.",
    conversationId: null,
    createdAtX: new Date("2026-10-06T08:00:00Z"),
  },
  {
    id: "2",
    tweetId: "1850000000000000002",
    authorId: "67890",
    authorHandle: "dev_journey",
    text: "Just spent 3 hours debugging a missing `await`. JavaScript giveth and JavaScript taketh away. 😅",
    conversationId: null,
    createdAtX: new Date("2026-10-06T09:15:00Z"),
  },
  {
    id: "3",
    tweetId: "1850000000000000003",
    authorId: "11111",
    authorHandle: "build_in_public",
    text: "Launched our MVP yesterday. 0 users so far. Is this normal or did we mess up our go-to-market?",
    conversationId: null,
    createdAtX: new Date("2026-10-06T10:30:00Z"),
  },
  {
    id: "4",
    tweetId: "1850000000000000004",
    authorId: "22222",
    authorHandle: "ai_enthusiast",
    text: "Hot take: RAG is over-engineered for 90% of use cases. Most people just need a well-written prompt and good data preprocessing.",
    conversationId: null,
    createdAtX: new Date("2026-10-06T11:45:00Z"),
  },
  {
    id: "5",
    tweetId: "1850000000000000005",
    authorId: "33333",
    authorHandle: "founder_feedback",
    text: "We're considering moving from PostgreSQL to MongoDB for our analytics service. The schema keeps changing. Anyone made this switch? Regrets?",
    conversationId: null,
    createdAtX: new Date("2026-10-06T13:00:00Z"),
  },
];

/**
 * Mock implementation of TweetSource that returns hardcoded sample tweets.
 *
 * Used during development to build and test the pipeline without
 * requiring X API credentials. When ready, swap this for TwitterSource.
 */
export class MockSource implements TweetSource {
  private index = 0;

  async getNewTweets(): Promise<TweetData[]> {
    // Simulate pagination — return one new tweet per call
    if (this.index >= SAMPLE_TWEETS.length) {
      return [];
    }

    const tweet = SAMPLE_TWEETS[this.index]!;
    this.index++;
    return [tweet];
  }

  /** Reset the source (useful for testing). */
  reset(): void {
    this.index = 0;
  }
}