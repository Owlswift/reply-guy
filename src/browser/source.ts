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
    
    // Extract tweets
    const tweets = await page.evaluate(() => {
      const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
      const results: { id: string; authorId: string; authorHandle: string; text: string; createdAt: string }[] = [];
      
      tweetElements.forEach((element: any) => {
        // Extract tweet ID from the status link
        const linkElement = element.querySelector('a[href*="/status/"]');
        const href = linkElement?.getAttribute('href') || '';
        const idMatch = href.match(/\/status\/(\d+)/);
        const id = idMatch ? idMatch[1] : '';
        
        // Extract author handle
        const handleElement = element.querySelector('[data-testid="User-Name"] a');
        const authorHandle = handleElement?.textContent?.replace('@', '') || '';
        
        // Extract tweet text
        const textElement = element.querySelector('[data-testid="tweetText"]');
        const text = textElement?.textContent || '';
        
        // Extract timestamp
        const timeElement = element.querySelector('time');
        const datetime = timeElement?.getAttribute('datetime') || '';
        
        if (id && text) {
          results.push({
            id,
            authorId: '', // Will need to extract from user link
            authorHandle,
            text,
            createdAt: datetime
          });
        }
      });
      
      return results;
    });
    
    return tweets.map((t: { id: string; authorId: string; authorHandle: string; text: string; createdAt: string }) => ({
      id: t.id,
      authorId: t.authorId,
      authorHandle: t.authorHandle,
      text: t.text,
      createdAt: t.createdAt ? new Date(t.createdAt) : new Date()
    }));
  }
}
