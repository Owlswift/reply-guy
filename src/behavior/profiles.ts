import { randomDelayMs } from "./delays";

export type BehaviorProfileName = "fast" | "normal" | "distracted";

export interface BehaviorProfile {
  name: BehaviorProfileName;
  label: string;
  // Delay before opening a tweet (ms) — simulates "deciding" to click in
  open: [number, number];
  // Reading time before replying, scaled by how much content is on screen
  readMin: number; // one-liner
  readMax: number; // long thread (cap)
  readRefChars: number; // content length that maps to readMax
  // Pause between replies (ms)
  betweenReplies: [number, number];
  // Poll interval between timeline checks (ms)
  poll: [number, number];
  // Occasional long pause for the distracted profile (ms), if defined
  distractedPause?: [number, number];
}

// Three consistent "personas". A real person isn't uniformly random on every
// action — they have habits. We pick ONE profile for the whole session so Echo
// behaves consistently, with only slight variability within that behavior.
export const PROFILES: Record<BehaviorProfileName, BehaviorProfile> = {
  fast: {
    name: "fast",
    label: "Fast reader",
    open: [1000, 3000],
    readMin: 2000,
    readMax: 5000,
    readRefChars: 800,
    betweenReplies: [3000, 8000],
    poll: [15000, 40000],
  },
  normal: {
    name: "normal",
    label: "Normal",
    open: [2000, 5000],
    readMin: 5000,
    readMax: 12000,
    readRefChars: 1200,
    betweenReplies: [8000, 20000],
    poll: [20000, 60000],
  },
  distracted: {
    name: "distracted",
    label: "Distracted",
    open: [3000, 8000],
    readMin: 8000,
    readMax: 20000,
    readRefChars: 1500,
    betweenReplies: [8000, 20000],
    poll: [30000, 90000],
    distractedPause: [30000, 90000],
  },
};

const PROFILE_NAMES = Object.keys(PROFILES) as BehaviorProfileName[];

// Chosen once at startup and kept for the session. Set BEHAVIOR_PROFILE in
// .env (fast | normal | distracted) to pin it; otherwise picked randomly.
function pickInitialProfile(): BehaviorProfile {
  const envName = process.env.BEHAVIOR_PROFILE?.toLowerCase();
  if (envName) {
    if (PROFILE_NAMES.includes(envName as BehaviorProfileName)) {
      return PROFILES[envName as BehaviorProfileName];
    }
    console.warn(
      `[behavior] Invalid BEHAVIOR_PROFILE "${envName}" — expected one of ${PROFILE_NAMES.join(", ")}. Falling back to random.`
    );
  }
  return PROFILES[PROFILE_NAMES[Math.floor(Math.random() * PROFILE_NAMES.length)]!];
}

let activeProfile: BehaviorProfile = pickInitialProfile();

export function getProfile(): BehaviorProfile {
  return activeProfile;
}

export function setProfile(name: BehaviorProfileName): void {
  activeProfile = PROFILES[name];
}

export function getProfileLabel(): string {
  return activeProfile.label;
}

// Delay before opening a tweet.
export function openDelay(): number {
  const [min, max] = activeProfile.open;
  return randomDelayMs(min, max);
}

// Reading time before replying, scaled by how much content is on screen.
// A one-liner sits near readMin; a long thread approaches readMax. ±20% jitter
// keeps it human without being robotic.
export function readDelay(text: string): number {
  const len = text?.length ?? 0;
  const ratio = Math.min(1, len / activeProfile.readRefChars);
  const scaled =
    activeProfile.readMin + (activeProfile.readMax - activeProfile.readMin) * ratio;
  const jitter = scaled * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}

// Pause between replies.
export function betweenRepliesDelay(): number {
  const [min, max] = activeProfile.betweenReplies;
  return randomDelayMs(min, max);
}

// Poll interval between timeline checks.
export function pollDelay(): number {
  const [min, max] = activeProfile.poll;
  return randomDelayMs(min, max);
}

// Occasional long pause — only the distracted profile does this (~30% chance).
export function maybeDistractedPause(): number {
  const p = activeProfile;
  if (!p.distractedPause) return 0;
  if (Math.random() < 0.3) {
    const [min, max] = p.distractedPause;
    return randomDelayMs(min, max);
  }
  return 0;
}