import { TweetCategory } from "../types/analysis";

type KeywordMap = {
  well_wish: RegExp[];
  greeting: RegExp[];
  question: RegExp[];
  meme: RegExp[];
  sports: RegExp[];
  politics: RegExp[];
  career: RegExp[];
  advice: RegExp[];
  story: RegExp[];
  humor: RegExp[];
  opinion: RegExp[];
  news: RegExp[];
};

const KEYWORDS: KeywordMap = {
  well_wish: [
    /happy (sunday|monday|tuesday|wednesday|thursday|friday|saturday|new week|weekend)/i,
    /it's (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i,
    /(sunday|monday) (morning|afternoon|evening|night)/i,
    /(blessed|grace|happy|thank).*\b(sunday|monday)\b/i,
    /\b(god bless|bless you|amen|prayer|praying|pray for|blessings|grateful|thank god|praise god)\b/i,
    /\bgod is (good|real|great|faithful|able|so good)\b/i,
  ],
  greeting: [
    /good (morning|afternoon|evening|night)/i,
    /^(morning|gm)\b/i,
    /\bgm\b/i,
  ],
  question: [
    /\?/,
  ],
  meme: [
    /😂|🤣|💀|🗿/,
    /\bmeme\b/i,
  ],
  sports: [
    /\b(football|soccer|nba|nfl|mlb|ufc|champions league|premier league|super bowl|world cup|f1|formula 1|tennis|cricket|nhl)\b/i,
    /\b(goal|touchdown|home run|knockout|pole position|ace)\b/i,
    /🏀|⚽|🏈|⚾|🎾|🏎️|🏆/,
  ],
  politics: [
    /\b(trump|biden|congress|senate|democrat|republican|election 2026|supreme court|legislation|vote|abortion|gun control|climate bill)\b/i,
    /\b(administration|policy|governor|senator|campaign|polling)\b/i,
  ],
  career: [
    /\b(job|resign|layoff|hired|fired|interview|promotion|salary|raise|startup|founder|ceo|cto|career|resume|portfolio|freelance|contract)\b/i,
    /\b(interview|offer|notice period|working at|quit my job|got laid off)\b/i,
    /\b(side hustle|passive income|b2b|saas|exit|acquisition|ipo)\b/i,
  ],
  advice: [
    /\b(protip|pro tip|advice|tip for|lesson learned|here's what I learned|my advice|if you're|you should|never do this|always do this)\b/i,
    /\b(unpopular opinion|hot take|my take on)\b/i,
    /thread 🧵/,
  ],
  story: [
    /\b(so yesterday|the other day|this one time|let me tell you|story time|this happened|just had|i was \w+ing when)\b/i,
    /\ba while back\b/i,
  ],
  humor: [
    /😂|🤣|lol|lmao|lmfao/i,
    /\bis a joke\b|\bis funny\b/i,
  ],
  opinion: [
    /\b(i think|i believe|in my opinion|imo|imho|honestly|frankly|personally|to be honest|the truth is|here's the thing)\b/i,
    /\b(unpopular opinion|hot take|controversial take)\b/i,
  ],
  news: [
    /\b(released|launch|announcing|breaking|just announced|reports say|according to|exclusive|leaked|unveiled|new study|new report)\b/i,
    /\b(is now|has been|will be) (available|shipping|launching|releasing)\b/i,
  ],
};

export function classifyTweet(text: string): TweetCategory {
  const t = text.trim();

  // Check patterns in priority order
  // Well-wish and greeting are highest priority — short auto-replies
  for (const pattern of KEYWORDS.well_wish) {
    if (pattern.test(t)) return "well_wish";
  }
  for (const pattern of KEYWORDS.greeting) {
    if (pattern.test(t)) return "greeting";
  }
  for (const pattern of KEYWORDS.meme) {
    if (pattern.test(t)) return "meme";
  }
  for (const pattern of KEYWORDS.advice) {
    if (pattern.test(t)) return "advice";
  }
  for (const pattern of KEYWORDS.sports) {
    if (pattern.test(t)) return "sports";
  }
  for (const pattern of KEYWORDS.politics) {
    if (pattern.test(t)) return "politics";
  }
  for (const pattern of KEYWORDS.career) {
    if (pattern.test(t)) return "career";
  }
  for (const pattern of KEYWORDS.story) {
    if (pattern.test(t)) return "story";
  }
  for (const pattern of KEYWORDS.question) {
    if (pattern.test(t)) return "question";
  }
  for (const pattern of KEYWORDS.opinion) {
    if (pattern.test(t)) return "opinion";
  }
  for (const pattern of KEYWORDS.news) {
    if (pattern.test(t)) return "news";
  }

  // Fallback
  return "general";
}