/**
 * Classification of a reply's content — what kind of interaction it is.
 */
export type ReplyClass =
  | "QUESTION"
  | "GREETINGS"
  | "WELL_WISH"
  | "DISAGREEMENT"
  | "AGREEMENT"
  | "CONVERSATION_CLOSER"
  | "JOKE"
  | "SHARING_EXPERIENCE"
  | "FOLLOW_UP"
  | "PRAISE"
  | "CRITICISM"
  | "THANK_YOU"
  | "SPAM"
  | "BOT"
  | "EMOJI_ONLY"
  | "TAGGING_FRIEND"
  | "MISUNDERSTANDING";

/**
 * What Echo should do with this reply.
 */
export type EngagementDecision =
  | "IGNORE"
  | "LIKE_ONLY"
  | "REPLY"
  | "REPLY_AND_LIKE"
  | "END_CONVERSATION";

/**
 * The state of a conversation thread between Echo and another user.
 */
export type ConversationState = "OPEN" | "WAITING_FOR_THEM" | "ENDED";

/**
 * Result of classifying a single reply in the thread.
 */
export interface ReplyClassification {
  replyClass: ReplyClass;
  engagementDecision: EngagementDecision;
  reason: string;
}

/**
 * A single reply extracted from the thread.
 */
export interface ThreadReply {
  id: string;
  authorHandle: string;
  authorName: string;
  text: string;
  createdAt: number;
  isByMe: boolean;
  parentReplyId: string | null;
  depth: number;
}

/**
 * The full thread structure — the original tweet plus all replies.
 */
export interface ThreadStructure {
  rootTweetId: string;
  rootTweetUrl: string;
  rootTweetAuthor: string;
  rootTweetText: string;
  replies: ThreadReply[];
}

/**
 * Persisted state for a conversation thread.
 */
export interface ThreadConversationState {
  rootTweetId: string;
  state: ConversationState;
  lastReplyAt: number;
  replyCount: number;
  participants: string[];
}

/**
 * Configuration for the engage command.
 */
export interface EngageConfig {
  /** Minimum wait between replies (ms) */
  minWaitMs: number;
  /** Maximum wait between replies (ms) */
  maxWaitMs: number;
  /** Whether to like tweets that are LIKE_ONLY */
  shouldLike: boolean;
  /** Maximum replies to post in one engage session */
  maxReplies: number;
}