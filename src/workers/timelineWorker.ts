// This worker is DISABLED.
// It was a background loop that navigated directly to https://x.com/home,
// causing race conditions with the main thread.
// 
// The bot now runs as a single-threaded pipeline in src/main-interactive.ts.
// All navigation goes through BrowserNavigator which only uses /i/timeline.
// 
// See src/main-interactive.ts for the current implementation.
export const runTimelineWorker = async () => {
  console.log("timelineWorker is disabled — use src/main-interactive.ts instead");
};
