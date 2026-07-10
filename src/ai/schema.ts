import { z } from "zod";

export const ReplySchema = z.object({
  shouldReply: z.boolean(),
  confidence: z.number().min(0).max(100),
  reason: z.string(),
  reply: z.string(),
});

export type ReplyResult = z.infer<typeof ReplySchema>;