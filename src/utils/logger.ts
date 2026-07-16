let lastLogAt = Date.now();

export function log(message: string): void {
  lastLogAt = Date.now();
  console.log(
    `[${new Date().toLocaleTimeString()}] ${message}`
  );
}

/**
 * Milliseconds since the last log() call — used by the watchdog to detect
 * a hung browser/page (a stuck Playwright call never throws, it just never
 * resolves, so nothing else signals the hang).
 */
export function msSinceLastLog(): number {
  return Date.now() - lastLogAt;
}