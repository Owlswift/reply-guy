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
   * Check if currently busy (reviewing or posting)
   * These are the states where other operations should pause
   */
  isBusy(): boolean {
    return (
      this.state === EchoState.REVIEWING ||
      this.state === EchoState.POSTING
    );
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