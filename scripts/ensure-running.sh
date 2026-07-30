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

# The dispatcher (src/dispatcher.ts) is the only thing that ever actually
# posts a queued reply — a genuinely separate process from the main bot,
# not an alternative to it, so it needs its own independent
# check-and-start, not folded into is_running()/the branches above. Called
# unconditionally, regardless of whatever the main-bot check above decided.
is_dispatcher_running() {
  pgrep -f "src/dispatcher.ts" > /dev/null 2>&1 ||
  pgrep -f "scripts/watch-and-restart-dispatcher.sh" > /dev/null 2>&1
}

ensure_dispatcher() {
  if is_dispatcher_running; then
    log "Dispatcher is already running."
    return
  fi
  log "Dispatcher is not running — starting under supervision..."
  nohup npm run dispatcher:watch >> "logs/dispatcher.log" 2>&1 &
  disown
  log "Dispatcher started (PID $!). Logging to logs/dispatcher.log."
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

CHROME_DEBUG_PORT=9222
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Profile Echo actually automates (already signed into the target X
# account) — only used for the cold-start fallback below. Override with
# CHROME_PROFILE_DIRECTORY=... if that ever changes.
CHROME_PROFILE_DIRECTORY="${CHROME_PROFILE_DIRECTORY:-Profile 2}"

chrome_debug_up() {
  curl -s "http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version" > /dev/null 2>&1
}

# Talks to the debug-enabled Chrome instance directly over its own CDP HTTP
# API instead of `open -a "Google Chrome"` / AppleScript's
# `tell application "Google Chrome"`. Both of those always address macOS's
# default LaunchServices Chrome instance — with a second, debug-flagged
# Chrome process also running (the one Echo actually connects to over CDP,
# started with --remote-debugging-port), that's the WRONG one: it opened a
# separate default-profile Chrome window every few minutes instead of
# reusing the existing debug instance. Going straight through the debug
# port removes the ambiguity — there's only one process listening there.
ensure_chrome_xcom() {
  if ! chrome_debug_up; then
    log "No debug-enabled Chrome on port ${CHROME_DEBUG_PORT} — launching \"${CHROME_PROFILE_DIRECTORY}\" with remote debugging..."
    nohup "$CHROME_BIN" \
      --remote-debugging-port="$CHROME_DEBUG_PORT" \
      --profile-directory="$CHROME_PROFILE_DIRECTORY" \
      "https://x.com" > /dev/null 2>&1 &
    disown
    for _ in $(seq 1 30); do
      chrome_debug_up && { log "Debug Chrome instance is up."; return; }
      sleep 1
    done
    log "Debug Chrome instance did not come up within 30s."
    return
  fi

  local has_tab
  has_tab=$(curl -s "http://127.0.0.1:${CHROME_DEBUG_PORT}/json/list" | grep -c '"url": *"https://x\.com')
  if [[ "$has_tab" == "0" ]]; then
    log "Debug Chrome is running but has no x.com tab — opening one..."
    curl -s "http://127.0.0.1:${CHROME_DEBUG_PORT}/json/new?https://x.com" > /dev/null
  fi
}

if is_running; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') Echo is already running."
  ensure_dispatcher
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
  ensure_dispatcher
  exit 0
fi

if [[ "$1" == "--foreground" || "$1" == "-t" ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') Echo is not running — opening a Terminal window..."
  PROJECT_DIR="$(pwd)"
  osascript -e "tell application \"Terminal\" to do script \"cd '$PROJECT_DIR' && npm run start:interactive:watch | tee -a '$LOG_FILE'\""
  ensure_dispatcher
  exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Echo is not running — starting under supervision..."
nohup npm run start:interactive:watch >> "$LOG_FILE" 2>&1 &
disown
echo "$(date '+%Y-%m-%d %H:%M:%S') Started (PID $!). Logging to $LOG_FILE."
ensure_dispatcher
