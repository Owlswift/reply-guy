import { shouldReply } from "./decision/shouldReply";
import { TimelineTweet } from "./types/tweet";

// Test 1: Mutual account
const mutualTweet: TimelineTweet = {
  id: "123",
  author: "John Doe",
  username: "johndoe",
  text: "This is a great tweet about React Native!",
  url: "https://x.com/johndoe/status/123",
  verified: false,
  following: true,
  followsYou: true,
  likes: 15,
  replies: 5,
  reposts: 2
};

console.log("Mutual tweet:", shouldReply(mutualTweet));

// Test 2: Following but not mutual
const followingTweet: TimelineTweet = {
  id: "456",
  author: "Jane Smith",
  username: "janesmith",
  text: "Check out this new library!",
  url: "https://x.com/janesmith/status/456",
  verified: false,
  following: true,
  followsYou: false,
  likes: 5,
  replies: 1,
  reposts: 0
};

console.log("Following tweet:", shouldReply(followingTweet));

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
  text: "This is a very long tweet about something interesting that I want to discuss in detail because it's important.",
  url: "https://x.com/randomuser/status/101",
  verified: false,
  following: false,
  followsYou: false,
  likes: 50,
  replies: 10,
  reposts: 5
};

console.log("Stranger tweet:", shouldReply(strangerTweet));

console.log("\nAll decision tests passed!");