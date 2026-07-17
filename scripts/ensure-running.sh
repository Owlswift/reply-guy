#!/bin/bash

# Checks whether Echo is running (either directly or under the supervisor
# from watch-and-restart.sh); starts it under supervision if it's not.
# Safe to run repeatedly — no-ops if something's already running, so it can
# be called by hand, from a login script, or on a schedule.

cd "$(dirname "$0")/.."

mkdir -p logs
LOG_FILE="logs/echo.log"

is_running() {
  # Matches the actual node process regardless of how tsx invokes it under
  # the hood (loader flags, cli.mjs, etc. — "tsx" never actually appears
  # immediately adjacent to the script path, so don't match on that).
  pgrep -f "main-interactive.ts" > /dev/null 2>&1 ||
  pgrep -f "scripts/watch-and-restart.sh" > /dev/null 2>&1
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
