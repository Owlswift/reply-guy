import fs from "fs";

export interface ReplyLog {
  tweet: string;
  author: string;
  reply: string;
  success: boolean;
  time: string;
}

export function logReply(data: ReplyLog): void {
  fs.appendFileSync(
    "replies.log",
    JSON.stringify(data) + "\n"
  );
}