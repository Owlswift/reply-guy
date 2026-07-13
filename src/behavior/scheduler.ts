/**
 * Daily Scheduler — Gives Echo a natural daily rhythm.
 *
 * Instead of random delays, Echo follows a session-based schedule:
 *
 *   Morning session (45–80 min)
 *   → Break (18–90 min)
 *   → Afternoon session (20–45 min)
 *   → Break (18–90 min)
 *   → Evening session (60–120 min)
 *   → Done for the day
 *
 * Within each session, every action has randomized timing that includes
 * micro-breaks, reading-time scaling, and fatigue (slowing down over time).
 */

export interface DailySession {
  name: string;
  minDuration: number;   // minutes
  maxDuration: number;   // minutes
  startAfter: number;    // hours since midnight when this session type can begin
  endBefore: number;     // hours since midnight when this session type ends
  intensity: "heavy" | "moderate" | "casual";
}

export interface TodayPlan {
  sessions: Array<{
    name: string;
    startAt: number;     // hours since midnight
    endAt: number;       // hours since midnight
    duration: number;    // minutes
    intensity: "heavy" | "moderate" | "casual";
    repliesInSession: number;
  }>;
}

// ─── Session templates ───────────────────────────────────────────────────────

const SESSION_TEMPLATES: DailySession[] = [
  {
    name: "Morning",
    minDuration: 45,
    maxDuration: 80,
    startAfter: 8,
    endBefore: 11,
    intensity: "moderate",
  },
  {
    name: "Afternoon",
    minDuration: 20,
    maxDuration: 45,
    startAfter: 13,
    endBefore: 15,
    intensity: "casual",
  },
  {
    name: "Evening",
    minDuration: 60,
    maxDuration: 120,
    startAfter: 20,
    endBefore: 23,
    intensity: "heavy",
  },
];

// ─── Runtime state ───────────────────────────────────────────────────────────

let currentPlan: TodayPlan | null = null;
let currentSessionIndex = 0;
let currentSessionReplies = 0;
let sessionFatigue = 0;        // 0..1 — increases over the session

export function getSessionFatigue(): number {
  return sessionFatigue;
}

export function getCurrentPlan(): TodayPlan | null {
  return currentPlan;
}

export function getCurrentSessionIndex(): number {
  return currentSessionIndex;
}

export function getSessionName(): string {
  if (!currentPlan || currentSessionIndex >= currentPlan.sessions.length) {
    return "Idle";
  }
  return currentPlan.sessions[currentSessionIndex]!.name;
}

export function getSessionReplies(): number {
  return currentSessionReplies;
}

// ─── Plan generation ─────────────────────────────────────────────────────────

/**
 * Generate today's plan: pick sessions that fit within active hours,
 * assign random durations and reply counts.
 */
export function generateTodaysPlan(): TodayPlan {
  const hour = new Date().getHours();

  // Filter sessions that haven't passed yet
  const eligible = SESSION_TEMPLATES.filter(
    (s) => s.endBefore > hour
  );

    // Pick sessions with a bit of randomness — sometimes skip one
  const sessions = eligible.filter(() => Math.random() < 0.85);

  if (sessions.length === 0) {
    // Even if no sessions left, create at least one short one
    sessions.push(SESSION_TEMPLATES[SESSION_TEMPLATES.length - 1]!);
  }

  const plan: TodayPlan = {
    sessions: sessions.map((template: DailySession) => {
      const duration =
        template.minDuration +
        Math.random() * (template.maxDuration - template.minDuration);

      // Replies per session: heavy = 2-4/min, moderate = 1-3/min, casual = 0.5-1.5/min
      let repliesPerMin: [number, number];
      switch (template.intensity) {
        case "heavy":
          repliesPerMin = [2, 4];
          break;
        case "moderate":
          repliesPerMin = [1, 3];
          break;
        case "casual":
          repliesPerMin = [0.5, 1.5];
          break;
      }

      const repliesInSession = Math.round(
        duration *
          (repliesPerMin[0] + Math.random() * (repliesPerMin[1] - repliesPerMin[0]))
      );

      // Start time: within the session window, with some randomness
      const windowStart = template.startAfter;
      const windowEnd = Math.min(template.endBefore, 24);
      const startAt = Math.max(windowStart, windowStart + Math.random() * Math.max(0.1, windowEnd - windowStart - duration / 60));
      const endAt = startAt + duration / 60;

      return {
        name: template.name,
        startAt,
        endAt,
        duration: Math.round(duration),
        intensity: template.intensity,
        repliesInSession,
      };
    }),
  };

  return plan;
}

// ─── Session lifecycle ───────────────────────────────────────────────────────

/**
 * Call at startup to initialize the daily plan.
 */
export function initScheduler(): void {
  currentPlan = generateTodaysPlan();
  currentSessionIndex = 0;
  currentSessionReplies = 0;
  sessionFatigue = 0;

  console.log("\n📅 Today's plan:");
  for (const s of currentPlan.sessions) {
    const startStr = `${Math.floor(s.startAt).toString().padStart(2, "0")}:${((s.startAt % 1) * 60).toString().padStart(2, "0")}`;
    const endStr = `${Math.floor(s.endAt).toString().padStart(2, "0")}:${((s.endAt % 1) * 60).toString().padStart(2, "0")}`;
    console.log(`   ${startStr}–${endStr}  ${s.name} (${s.duration} min, ${s.repliesInSession} replies, ${s.intensity})`);
  }
  console.log();
}

/**
 * Check if we're currently in a scheduled session.
 */
export function isInSession(): boolean {
  if (!currentPlan) return false;
  if (currentSessionIndex >= currentPlan.sessions.length) return false;

  const session = currentPlan.sessions[currentSessionIndex]!;
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  return currentHour >= session.startAt && currentHour < session.endAt;
}

/**
 * Advance to the next session. Returns true if there is a next session.
 */
export function advanceSession(): boolean {
  currentSessionReplies = 0;
  sessionFatigue = 0;
  currentSessionIndex++;
  return currentSessionIndex < (currentPlan?.sessions.length ?? 0);
}

/**
 * Force-start a session immediately, overriding the scheduler's time check.
 * Sets the current session's startAt to now so isInSession() returns true.
 * If all sessions have passed, creates a new session on the fly.
 */
export function forceStartSession(): void {
  if (!currentPlan) return;
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  // If past the last session, append a new one
  if (currentSessionIndex >= currentPlan.sessions.length) {
    currentPlan.sessions.push({
      name: "Override",
      startAt: currentHour - 0.01,
      endAt: currentHour + 1.5,
      duration: 90,
      intensity: "heavy",
      repliesInSession: 300,
    });
    currentSessionIndex = currentPlan.sessions.length - 1;
  } else {
    currentPlan.sessions[currentSessionIndex]!.startAt = currentHour - 0.01;
    currentPlan.sessions[currentSessionIndex]!.endAt = currentHour + 1.5;
  }
  currentSessionReplies = 0;
  sessionFatigue = 0;
}

/**
 * Called after each reply in the current session.
 * Updates fatigue and checks if session reply limit is reached.
 * Returns true if the session should end (reached reply limit).
 */
export function didSessionEnd(): boolean {
  if (!currentPlan || currentSessionIndex >= currentPlan.sessions.length) {
    return true;
  }

  currentSessionReplies++;

  // Increase fatigue: 0 at first reply, approaches 1 as session progresses
  const session = currentPlan.sessions[currentSessionIndex]!;
  sessionFatigue = Math.min(1, currentSessionReplies / session.repliesInSession);

  return currentSessionReplies >= session.repliesInSession;
}

/**
 * Get the break duration between sessions.
 * Returns 0 if this was the last session.
 */
export function getBreakBetweenSessions(): number {
  if (!currentPlan || currentSessionIndex >= currentPlan.sessions.length - 1) {
    return 0;
  }
  // 18–90 minutes in milliseconds
  return (18 * 60_000 + Math.random() * 72 * 60_000);
}

/**
 * Check if this was the final session of the day.
 */
export function isLastSession(): boolean {
  if (!currentPlan) return true;
  return currentSessionIndex >= currentPlan.sessions.length - 1;
}

/**
 * Get the hour when the next session starts (for logging).
 */
export function getNextSessionTime(): string {
  if (!currentPlan || currentSessionIndex + 1 >= currentPlan.sessions.length) {
    return "—";
  }
  const next = currentPlan.sessions[currentSessionIndex + 1]!;
  const h = Math.floor(next.startAt);
  const m = Math.round((next.startAt % 1) * 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

// ─── Action timing (within a session) ────────────────────────────────────────

/**
 * Reading time before replying — scaled by tweet length and current fatigue.
 * Returns milliseconds.
 */
export function getReadingTime(text: string): number {
  const len = text?.length ?? 0;

  // Base reading time: 15–40 seconds based on tweet length
  const baseMin = 15_000;
  const baseMax = 40_000;
  const ratio = Math.min(1, len / 1200);
  const baseTime = baseMin + (baseMax - baseMin) * ratio;

  // Fatigue multiplier: at fatigue=0, no multiplier. At fatigue=1, 2x
  const fatigueMultiplier = 1 + sessionFatigue * 1.0;

  // ±30% jitter
  const jitter = 0.7 + Math.random() * 0.6;

  return Math.round(baseTime * fatigueMultiplier * jitter);
}

/**
 * Small filler action like scrolling, skipping, or pausing mid-session.
 * Scales with fatigue — fast at start, slower after ~15 min.
 * Returns milliseconds.
 */
export function getMicroBreak(): number {
  // Base: 2–8s when fresh, grows to 5–30s when fatigued
  const baseMin = 2_000;
  const baseMax = 8_000;
  const fatigueMin = 5_000;
  const fatigueMax = 30_000;
  const min = baseMin + (fatigueMin - baseMin) * sessionFatigue;
  const max = baseMax + (fatigueMax - baseMax) * sessionFatigue;
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Delay between finishing reading and starting to reply.
 * Simulates "deciding what to say."
 * Scales with fatigue — fast at start, slower after ~15 min.
 * Returns milliseconds.
 */
export function getThinkingTime(): number {
  // Base: 1–4s when fresh, grows to 3–12s when fatigued
  const baseMin = 1_000;
  const baseMax = 4_000;
  const fatigueMin = 3_000;
  const fatigueMax = 12_000;
  const min = baseMin + (fatigueMin - baseMin) * sessionFatigue;
  const max = baseMax + (fatigueMax - baseMax) * sessionFatigue;
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Pause after posting a reply before the next action.
 * Gets longer with fatigue.
 * Returns milliseconds.
 */
export function getPostReplyPause(): number {
  // Base: 3–8s when fresh, grows to 8–23s when fatigued
  const baseMin = 3_000;
  const baseMax = 8_000;
  const fatigueMin = 8_000;
  const fatigueMax = 23_000;
  const min = baseMin + (fatigueMin - baseMin) * sessionFatigue;
  const max = baseMax + (fatigueMax - baseMax) * sessionFatigue;
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Occasional random interruption — checking notifications, getting distracted.
 * ~10% chance when fresh, up to ~20% when fatigued.
 * Returns 0 if no interruption.
 */
export function maybeInterruption(): number {
  // Interruption chance scales with fatigue: 10% → 20%
  const chance = 0.10 + sessionFatigue * 0.10;
  if (Math.random() > chance) return 0;

  // Duration: 15–60s when fresh, 30s–4min when fatigued
  const baseMin = 15_000;
  const baseMax = 60_000;
  const fatigueMin = 30_000;
  const fatigueMax = 240_000;
  const min = baseMin + (fatigueMin - baseMin) * sessionFatigue;
  const max = baseMax + (fatigueMax - baseMax) * sessionFatigue;
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Decide whether to occasionally skip reading a tweet and just scroll past.
 * ~20% chance.
 */
export function shouldSkipTweet(): boolean {
  return Math.random() < 0.2;
}

/**
 * "Mood" modifier for the current session — affects how many tweets
 * are actually replied to vs just read.
 * Returns 0.0 (read nothing) to 1.0 (reply to everything).
 */
export function getReplyRatio(): number {
  if (!currentPlan || currentSessionIndex >= currentPlan.sessions.length) {
    return 0.5;
  }

  switch (currentPlan.sessions[currentSessionIndex]!.intensity) {
    case "heavy":
      return 0.6 + Math.random() * 0.3; // 60–90%
    case "moderate":
      return 0.4 + Math.random() * 0.3; // 40–70%
    case "casual":
      return 0.2 + Math.random() * 0.3; // 20–50%
  }
}