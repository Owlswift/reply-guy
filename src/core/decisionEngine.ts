// NOTE: This file is deprecated — scoring now lives in src/decision/scoreTweet.ts
import { Relationship } from "../relationship/types";

export interface TweetScore {
  relationship: number;
  quality: number;
  relevance: number;
  freshness: number;
  total: number;
}

// Topics you care about (customize this)
const relevantTopics = [
  "ai",
  "software",
  "engineering",
  "programming",
  "startup",
  "business",
  "saas",
  "nigeria",
  "tech"
];

export function scoreTweet(
  text: string,
  relationship: Relationship,
  ageMinutes: number
): TweetScore {
  // Relationship score
  let relationshipScore = 0;
  if (relationship === "mutual") relationshipScore = 100;
  else if (relationship === "following") relationshipScore = 70;
  else if (relationship === "verified") relationshipScore = 50;
  else relationshipScore = 20;

  // Quality score (based on text length and content)
  const words = text.split(/\s+/).length;
  const qualityScore = Math.min(100, Math.max(20, words * 5));

  // Relevance score
  const lowerText = text.toLowerCase();
  const relevanceScore = relevantTopics.some(topic => lowerText.includes(topic)) ? 80 : 40;

  // Freshness score (newer tweets get higher scores)
  const freshnessScore = Math.max(0, 60 - ageMinutes);

  // Total score
  const total = relationshipScore + qualityScore + relevanceScore + freshnessScore;

  return {
    relationship: relationshipScore,
    quality: qualityScore,
    relevance: relevanceScore,
    freshness: freshnessScore,
    total
  };
}

// getPriority removed — use src/decision/scoreTweet.ts instead
