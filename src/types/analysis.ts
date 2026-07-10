export interface AnalysisResult {
  tweetId: string;
  shouldReply: boolean;
  confidence: number;
  reason: string;
}