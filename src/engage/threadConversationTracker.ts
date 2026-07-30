import fs from "fs";
import path from "path";

/**
 * The state of a conversation thread between Echo and another user.
 *
 * OPEN = new reply detected, we need to decide what to do
 * WAITING_FOR_THEM = we replied, waiting for their response
 * ENDED = conversation naturally concluded (agreement, thanks, etc.)
 */
export type ConversationState = "OPEN" | "WAITING_FOR_THEM" | "ENDED";

/**
 * A single node in the conversation tree.
 */
export interface ConversationNode {
  replyId: string;
  authorHandle: string;
  text: string;
  parentReplyId: string | null;
  depth: number;
  createdAt: number;
  isByMe: boolean;
}

/**
 * Persisted state for a conversation thread on a specific tweet.
 */
export interface ThreadConversationState {
  rootTweetId: string;
  state: ConversationState;
  lastReplyAt: number;
  replyCount: number;
  participants: string[];
  /** Ordered list of replies in the thread (flat, chronological) */
  replies: ConversationNode[];
  /** How many times I have replied in this thread */
  myReplyCount: number;
}

const FILE = path.join(process.cwd(), "engageConversations.json");

let cache: Map<string, ThreadConversationState> | null = null;

function load(): Map<string, ThreadConversationState> {
  if (cache) return cache;

  if (!fs.existsSync(FILE)) {
    cache = new Map();
    return cache;
  }

  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    cache = new Map(Object.entries(data));
  } catch {
    cache = new Map();
  }

  return cache;
}

function save(): void {
  if (!cache) return;
  fs.writeFileSync(
    FILE,
    JSON.stringify(Object.fromEntries(cache), null, 2)
  );
}

/**
 * Get the current conversation state for a root tweet.
 */
export function getConversationState(rootTweetId: string): ThreadConversationState | undefined {
  return load().get(rootTweetId);
}

/**
 * Get or create a conversation state for a root tweet.
 */
export function getOrCreateConversation(
  rootTweetId: string,
  participants: string[] = []
): ThreadConversationState {
  const conversations = load();
  if (conversations.has(rootTweetId)) {
    return conversations.get(rootTweetId)!;
  }

  const state: ThreadConversationState = {
    rootTweetId,
    state: "OPEN",
    lastReplyAt: 0,
    replyCount: 0,
    participants,
    replies: [],
    myReplyCount: 0,
  };

  conversations.set(rootTweetId, state);
  save();
  return state;
}

/**
 * Update the conversation state.
 */
export function updateConversationState(
  rootTweetId: string,
  updates: Partial<ThreadConversationState>
): ThreadConversationState {
  const conversations = load();
  const existing = conversations.get(rootTweetId);
  if (!existing) {
    const state: ThreadConversationState = {
      rootTweetId,
      state: "OPEN",
      lastReplyAt: 0,
      replyCount: 0,
      participants: [],
      replies: [],
      myReplyCount: 0,
      ...updates,
    };
    conversations.set(rootTweetId, state);
    save();
    return state;
  }

  Object.assign(existing, updates);
  save();
  return existing;
}

/**
 * Add a reply node to the conversation tree.
 */
export function addReplyNode(
  rootTweetId: string,
  node: ConversationNode
): void {
  const state = getOrCreateConversation(rootTweetId);
  state.replies.push(node);
  state.replyCount++;
  state.lastReplyAt = Date.now();

  if (node.isByMe) {
    state.myReplyCount++;
  }

  if (!state.participants.includes(node.authorHandle)) {
    state.participants.push(node.authorHandle);
  }

  save();
}

/**
 * Check if Echo has already replied to a specific reply in the thread.
 */
export function hasRepliedToReply(
  rootTweetId: string,
  replyId: string
): boolean {
  const state = getConversationState(rootTweetId);
  if (!state) return false;

  // If our node is a DIRECT child of this reply, we've replied to it
  return state.replies.some(
    (n) => n.isByMe && n.parentReplyId === replyId
  );
}

/**
 * Same check as hasRepliedToReply, but across every tracked conversation —
 * for callers that discover a reply id (e.g. scanning notifications) before
 * they know which of Echo's posts it's actually a reply to, and so can't
 * name a rootTweetId to look under yet.
 */
export function hasRepliedToReplyAnywhere(replyId: string): boolean {
  const conversations = load();
  for (const state of conversations.values()) {
    if (state.replies.some((n) => n.isByMe && n.parentReplyId === replyId)) {
      return true;
    }
  }
  return false;
}

/**
 * Determine if Echo should continue the conversation, given the tree.
 *
 * Rules:
 * - If Echo replied and the other person replied back → conversation is open
 * - If Echo replied and the other person never replied back → WAITING_FOR_THEM
 * - If Echo replied and the conversation naturally ended → ENDED
 */
export function evaluateConversationTree(
  rootTweetId: string
): {
  shouldEngage: boolean;
  reason: string;
} {
  const state = getConversationState(rootTweetId);
  if (!state) {
    return { shouldEngage: true, reason: "new conversation" };
  }

  if (state.state === "ENDED") {
    return { shouldEngage: false, reason: "conversation has ended" };
  }

  if (state.replies.length === 0) {
    return { shouldEngage: true, reason: "no replies yet" };
  }

  // If we have replied, check if the other person replied back
  if (state.myReplyCount > 0) {
    const myLastReply = [...state.replies]
      .reverse()
      .find((n) => n.isByMe);

    if (myLastReply) {
      // Check if anyone replied to our last reply
      const responsesToMe = state.replies.filter(
        (n) =>
          !n.isByMe &&
          n.parentReplyId === myLastReply.replyId
      );

      if (responsesToMe.length === 0) {
        // No one replied back — waiting for them
        if (state.state === "WAITING_FOR_THEM") {
          return {
            shouldEngage: false,
            reason: "waiting for them to reply",
          };
        }
      } else {
        // They replied back — conversation is open
        return {
          shouldEngage: true,
          reason: "they replied back, conversation continues",
        };
      }
    }
  }

  return { shouldEngage: true, reason: "conversation open" };
}

/**
 * Mark a conversation as ENDED.
 */
export function endConversation(rootTweetId: string): void {
  updateConversationState(rootTweetId, { state: "ENDED" });
}

/**
 * Mark a conversation as WAITING_FOR_THEM.
 */
export function waitForThem(rootTweetId: string): void {
  updateConversationState(rootTweetId, { state: "WAITING_FOR_THEM" });
}

/**
 * Mark a conversation as OPEN.
 */
export function reopenConversation(rootTweetId: string): void {
  updateConversationState(rootTweetId, { state: "OPEN" });
}

/**
 * Build the conversation context string for the AI prompt.
 * Shows the conversation tree in a readable format.
 */
export function buildConversationContext(
  rootTweetId: string,
  rootTweetText: string
): string {
  const state = getConversationState(rootTweetId);
  if (!state || state.replies.length === 0) return "";

  const lines: string[] = ["### Conversation so far:", ""];
  lines.push(`[Root tweet]: ${rootTweetText}`);
  lines.push("");

  for (const reply of state.replies) {
    const prefix = reply.isByMe ? "[Me]" : `[${reply.authorHandle}]`;
    const indent = "  ".repeat(reply.depth);
    lines.push(`${indent}${prefix}: ${reply.text}`);
  }

  lines.push("");
  return lines.join("\n");
}