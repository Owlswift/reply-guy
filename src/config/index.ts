import { TweetSource } from "../twitter/source";
import { MockSource } from "../twitter/mock-source";

/**
 * Central configuration for the application.
 *
 * When X API credentials are available, swap MockSource for TwitterSource.
 * The rest of the app never needs to know which source is active.
 */
export const config = {
  port: parseInt(process.env["PORT"] || "3000", 10),

  /** The active tweet source — swap implementations here. */
  tweetSource: (): TweetSource => {
    return new MockSource();
  },
};