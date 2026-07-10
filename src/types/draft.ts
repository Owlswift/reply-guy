export interface Draft {
  tweetId: string;
  shouldReply: boolean;
  confidence: number;
  reason: string;
  reply: string;
}