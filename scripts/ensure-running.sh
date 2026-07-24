#!/bin/bash

# Checks whether Echo is running (either directly or under the supervisor
# from watch-and-restart.sh); starts it under supervision if it's not.
# Safe to run repeatedly — no-ops if something's already running, so it can
# be called by hand, from a login script, or on a schedule.

cd "$(dirname "$0")/.."

mkdir -p logs
LOG_FILE="logs/echo.log"

# Guard against overlapping runs of this script itself. Without this, a
# slow ensure_docker/ensure_chrome_xcom wait (Docker can take up to its
# full 2-minute timeout) leaves no main-interactive.ts or
# watch-and-restart.sh process running yet — so if the next scheduled
# tick fires in that window, its own is_running() check ALSO finds
# nothing and launches a second, fully separate supervised app tree.
LOCK_FILE="/tmp/echo-ensure-running.lock"
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID="$(cat "$LOCK_FILE" 2>/dev/null)"
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') Another ensure-running.sh (PID $LOCK_PID) is still in progress — skipping this run."
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

is_running() {
  # Matches the actual node process regardless of how tsx invokes it under
  # the hood (loader flags, cli.mjs, etc. — "tsx" never actually appears
  # immediately adjacent to the script path, so don't match on that).
  #
  # Also treat a manual catch-up run (catchupPriorityHandles.ts) as "Echo
  # is doing something" — without this, this check only knows about the
  # main bot, so running the catch-up command alone (no main bot running)
  # looked like "not running" and this script would launch a second,
  # fully separate instance fighting the catch-up run over the same
  # shared browser session.
  pgrep -f "main-interactive.ts" > /dev/null 2>&1 ||
  pgrep -f "scripts/watch-and-restart.sh" > /dev/null 2>&1 ||
  pgrep -f "catchupPriorityHandles.ts" > /dev/null 2>&1
}

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1"
}

ensure_docker() {
  docker info > /dev/null 2>&1 && return 0
  log "Docker is not running — launching Docker Desktop..."
  open -a Docker
  for _ in $(seq 1 60); do
    docker info > /dev/null 2>&1 && { log "Docker is up."; return 0; }
    sleep 2
  done
  log "Docker did not come up within 2 minutes — continuing anyway."
}

ensure_chrome_xcom() {
  if ! pgrep -f "Google Chrome" > /dev/null 2>&1; then
    log "Chrome is not running — launching and opening x.com..."
    open -a "Google Chrome" "https://x.com"
    return
  fi
  local has_tab
  has_tab=$(osascript -e 'tell application "Google Chrome"
    repeat with w in windows
      repeat with t in tabs of w
        if URL of t contains "x.com" then return "yes"
      end repeat
    end repeat
    return "no"' 2>/dev/null)
  if [[ "$has_tab" != "yes" ]]; then
    log "Chrome is running but has no x.com tab — opening one..."
    osascript -e 'tell application "Google Chrome" to open location "https://x.com"'
  fi
}

if is_running; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') Echo is already running."
  exit 0
fi

ensure_docker
ensure_chrome_xcom

# Re-check right before actually launching. ensure_docker alone can block
# for up to its full 2-minute timeout — if a manual run (e.g. in iTerm) got
# started anytime between the is_running() check above and now, launching
# unconditionally here would spin up a second, fully separate instance
# fighting the manual one over the same shared browser session. This is
# exactly how "I was running it in iTerm and another one spun up on its
# own" happens: launchd fires this script every 5 minutes (see
# com.echo.ensure-running.plist), and the first check can go stale during
# the docker/chrome wait.
if is_running; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') Echo started running while waiting on docker/chrome — not launching a second instance."
  exit 0
fi

if [[ "$1" == "--foreground" || "$1" == "-t" ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') Echo is not running — opening a Terminal window..."
  PROJECT_DIR="$(pwd)"
  osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR' && npm run start:interactive:watch | tee -a '$LOG_FILE'\""
  exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Echo is not running — starting under supervision..."
nohup npm run start:interactive:watch >> "$LOG_FILE" 2>&1 &
disown
echo "$(date '+%Y-%m-%d %H:%M:%S') Started (PID $!). Logging to $LOG_FILE."
