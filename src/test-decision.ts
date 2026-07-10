import { shouldReply } from "./decision/shouldReply";
import { TimelineTweet } from "./types/tweet";

// Test 1: Verified user
const verifiedTweet: TimelineTweet = {
  id: "123",
  author: "John Doe",
  username: "johndoe",
  text: "Short tweet",
  url: "https://x.com/johndoe/status/123",
  verified: true,
  following: false,
  followsYou: false,
  likes: 0,
  replies: 0,
  reposts: 0
};

console.log("Verified tweet:", shouldReply(verifiedTweet));

// Test 2: Verified user with high engagement
const verifiedEngagementTweet: TimelineTweet = {
  id: "456",
  author: "Jane Smith",
  username: "janesmith",
  text: "Short tweet",
  url: "https://x.com/janesmith/status/456",
  verified: true,
  following: false,
  followsYou: false,
  likes: 50,
  replies: 10,
  reposts: 5
};

console.log("Verified with engagement:", shouldReply(verifiedEngagementTweet));

// Test 3: Spam tweet
const spamTweet: TimelineTweet = {
  id: "789",
  author: "Crypto Bro",
  username: "cryptobro",
  text: "Airdrop alert! Get your free tokens now!",
  url: "https://x.com/cryptobro/status/789",
  verified: false,
  following: false,
  followsYou: false,
  likes: 0,
  replies: 0,
  reposts: 0
};

console.log("Spam tweet:", shouldReply(spamTweet));

// Test 4: Stranger with high engagement
const strangerTweet: TimelineTweet = {
  id: "101",
  author: "Random User",
  username: "randomuser",
  text: "Short tweet",
  url: "https://x.com/randomuser/status/101",
  verified: false,
  following: false,
  followsYou: false,
  likes: 100,
  replies: 15,
  reposts: 5
};

console.log("Stranger with engagement:", shouldReply(strangerTweet));

console.log("\nAll decision tests passed!");