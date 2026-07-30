#!/bin/bash

# Supervises `npm run dispatcher`, restarting it whenever it exits — same
# pattern as watch-and-restart.sh for main-interactive.ts. The dispatcher is
# the only process that ever actually posts a reply (storage/replyQueue.ts,
# src/dispatcher.ts), so it needs to stay up independently of whether
# main-interactive.ts's own loop is running.

cd "$(dirname "$0")/.."

RESTART_DELAY_SECONDS=5

# Own "keep the Mac awake" claim, same reasoning as watch-and-restart.sh —
# multiple caffeinate assertions coexist fine, and the dispatcher needs to
# keep running (and posting queued replies) even if main-interactive.ts
# isn't up at all.
caffeinate -dims -w $$ &

echo "=== Echo dispatcher supervisor started (restarts on any exit, ${RESTART_DELAY_SECONDS}s delay) ==="

while true; do
  npm run dispatcher
  exit_code=$?
  echo ""
  echo "=== Dispatcher exited (code $exit_code) at $(date '+%Y-%m-%d %H:%M:%S') — restarting in ${RESTART_DELAY_SECONDS}s ==="
  sleep "$RESTART_DELAY_SECONDS"
done
