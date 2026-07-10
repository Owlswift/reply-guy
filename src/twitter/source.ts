import { TweetData } from "../types";

/**
 * Abstract interface for fetching tweets.
 *
 * By coding to this interface, the rest of the app is decoupled
 * from any specific platform (X, Bluesky, RSS, etc.).
 *
 * To add a new source, implement this interface and register it
 * in the dependency injection / config layer.
 */
export interface TweetSource {
  /** Fetch new tweets that haven't been processed yet. */
  getNewTweets(): Promise<TweetData[]>;
}