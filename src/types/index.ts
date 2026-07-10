export interface TweetData {
  id: string;
  tweetId: string;
  authorId: string;
  authorHandle: string;
  text: string;
  conversationId: string | null;
  createdAtX: Date | null;
}