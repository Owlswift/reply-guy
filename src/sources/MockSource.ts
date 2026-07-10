import { TweetSource } from "./TweetSource";
import { Tweet } from "../types/tweet";

export class MockSource implements TweetSource {
  async fetch(): Promise<Tweet[]> {
    return [
      {
        id: "1",
        authorId: "123",
        authorHandle: "elonmusk",
        text: "AI will replace programmers within five years.",
        createdAt: new Date(),
      },
      {
        id: "2",
        authorId: "456",
        authorHandle: "addyosmani",
        text: "Writing good software is still about solving the right problems.",
        createdAt: new Date(),
      },
    ];
  }
}