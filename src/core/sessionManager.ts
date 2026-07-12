/**
 * SessionManager - Single source of truth for Echo's application state
 * 
 * This class manages the global state to prevent race conditions during review sessions.
 * When Echo is in REVIEWING state, all other operations (timeline reading, AI generation,
 * browser navigation) should pause and wait.
 */

export enum EchoState {
  IDLE = "IDLE",
  READING = "READING",
  GENERATING = "GENERATING",
  REVIEWING = "REVIEWING",
  PROCESSING = "PROCESSING",
  POSTING = "POSTING",
  RECOVERING = "RECOVERING"
}

class SessionManager {
  private state: EchoState = EchoState.IDLE;
  private reviewTweetId: string | null = null;
  private stateChangeCallbacks: Array<(state: EchoState) => void> = [];

  /**
   * Get current state
   */
  getState(): EchoState {
    return this.state;
  }

  /**
   * Check if currently reviewing
   */
  isReviewing(): boolean {
    return this.state === EchoState.REVIEWING;
  }

  /**
   * Check if currently busy (reviewing, processing a tweet, or posting)
   * These are the states where other operations (timeline reading, scrolling,
   * navigation) should pause. PROCESSING covers the window where the browser
   * worker has opened a tweet but has not yet entered the REVIEWING state.
   */
  isBusy(): boolean {
    return (
      this.state === EchoState.REVIEWING ||
      this.state === EchoState.PROCESSING ||
      this.state === EchoState.POSTING
    );
  }

  /**
   * Check if a tweet is currently being opened/processed by the browser worker.
   * During this window the page is on a /status/ conversation page, so the
   * timeline reader must NOT extract tweets from it.
   */
  isProcessing(): boolean {
    return this.state === EchoState.PROCESSING;
  }

  /**
   * Get the tweet ID being reviewed (if any)
   */
  getReviewingTweetId(): string | null {
    return this.reviewTweetId;
  }

  /**
   * Start a review session for a specific tweet
   * This pauses all other operations until endReview() is called
   */
  startReview(tweetId: string): void {
    this.state = EchoState.REVIEWING;
    this.reviewTweetId = tweetId;
    this.notifyStateChange();
    console.log(`[SessionManager] Entering REVIEWING state for tweet ${tweetId}`);
  }

  /**
   * End the current review session
   */
  endReview(): void {
    this.state = EchoState.IDLE;
    this.reviewTweetId = null;
    this.notifyStateChange();
    console.log(`[SessionManager] Exiting REVIEWING state, back to IDLE`);
  }

  /**
   * Set state to READING (timeline reading)
   */
  startReading(): void {
    if (this.isReviewing()) return;
    this.state = EchoState.READING;
    this.notifyStateChange();
  }

  /**
   * Set state to GENERATING (AI generation)
   */
  startGenerating(): void {
    if (this.isReviewing()) return;
    this.state = EchoState.GENERATING;
    this.notifyStateChange();
  }

  /**
   * Set state to POSTING
   */
  startPosting(): void {
    if (this.isReviewing()) return;
    this.state = EchoState.POSTING;
    this.notifyStateChange();
  }

  /**
   * Set state to PROCESSING (browser worker has opened a tweet and is reading it
   * before the review session starts). Extraction must pause during this window.
   */
  startProcessing(): void {
    if (this.isReviewing()) return;
    this.state = EchoState.PROCESSING;
    this.notifyStateChange();
  }

  /**
   * Leave PROCESSING state and return to IDLE.
   */
  endProcessing(): void {
    if (this.state !== EchoState.PROCESSING) return;
    this.state = EchoState.IDLE;
    this.notifyStateChange();
  }

  /**
   * Set state to RECOVERING
   */
  startRecovering(): void {
    if (this.isReviewing()) return;
    this.state = EchoState.RECOVERING;
    this.notifyStateChange();
  }

  /**
   * Return to IDLE state
   */
  goIdle(): void {
    if (this.isReviewing()) return;
    this.state = EchoState.IDLE;
    this.notifyStateChange();
  }

  /**
   * Register a callback for state changes
   */
  onStateChange(callback: (state: EchoState) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  private notifyStateChange(): void {
    for (const callback of this.stateChangeCallbacks) {
      callback(this.state);
    }
  }
}

// Singleton instance
export const sessionManager = new SessionManager();