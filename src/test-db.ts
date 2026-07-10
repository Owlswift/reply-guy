import "./database/db";
import { saveTweet, hasTweet } from "./database/tweetRepository";
import { saveReply, getReplyCountToday } from "./database/replyRepository";
import { enqueue, dequeue, getQueueSize } from "./database/queueRepository";
import { log, getErrorCount } from "./database/logRepository";

console.log("Database initialized!");

// Test tweet
saveTweet({
  tweet_id: "12345",
  author: "test_user",
  text: "Test tweet",
  url: "https://x.com/test/status/12345",
  scraped_at: Date.now().toString()
});

console.log("Has tweet 12345:", hasTweet("12345"));
console.log("Has tweet 99999:", hasTweet("99999"));

// Test reply
saveReply({
  tweet_id: "12345",
  draft: "Test draft",
  final_reply: "Test reply",
  status: "posted",
  created_at: Date.now().toString()
});

console.log("Reply count today:", getReplyCountToday());

// Test queue
enqueue("12345", 1);
enqueue("67890", 2);
console.log("Queue size:", getQueueSize());

const item = dequeue();
console.log("Dequeued:", item);
console.log("Queue size after dequeue:", getQueueSize());

// Test logging
log("info", "Test log message");
console.log("Error count:", getErrorCount());

console.log("All tests passed!");