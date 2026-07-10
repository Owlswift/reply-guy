import { TweetSource } from "../sources/TweetSource";
import { Tweet } from "../types/tweet";
import { getPage } from "./browser";

export class BrowserSource implements TweetSource {
  async fetch(): Promise<Tweet[]> {
    const page = await getPage();
    
    // Navigate to home timeline
    await page.goto("https://x.com/home");
    
    // Wait for tweets to load
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10000 });
    
    // Extract tweets using evaluateAll (runs in browser context)
    const rawTweets = await page.locator('article[data-testid="tweet"]').evaluateAll((articles) => {
      return articles.map((article) => {
        // Extract tweet ID from the status link
        const linkElement = article.querySelector('a[href*="/status/"]');
        const href = linkElement?.getAttribute('href') || '';
        const idMatch = href.match(/\/status\/(\d+)/);
        const id = idMatch ? idMatch[1] : '';
        
        // Extract author handle
        const handleElement = article.querySelector('[data-testid="User-Name"] a');
        const authorHandle = handleElement?.textContent?.replace('@', '') || '';
        
        // Extract tweet text
        const textElement = article.querySelector('[data-testid="tweetText"]');
        const text = textElement?.textContent || '';
        
        // Extract timestamp
        const timeElement = article.querySelector('time');
        const datetime = timeElement?.getAttribute('datetime') || '';
        
        return {
          id,
          authorId: '', // Will need to extract from user link
          authorHandle,
          text,
          createdAt: datetime
        };
      });
    });
    
    return rawTweets
      .filter(t => t.id && t.text)
      .map((t) => ({
        id: t.id,
        authorId: t.authorId,
        authorHandle: t.authorHandle,
        text: t.text,
        createdAt: t.createdAt ? new Date(t.createdAt) : new Date()
      }));
  }
}