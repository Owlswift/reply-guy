import { classifyTweet } from "./classifyTweet";
import { Relationship } from "../relationship/types";
import { buildPersonalityPrompt } from "../personality/prompt";

export function buildPrompt(tweet: string, relationship: Relationship = "stranger"): string {
  const type = classifyTweet(tweet);
  return buildPersonalityPrompt(tweet, relationship, type);
}