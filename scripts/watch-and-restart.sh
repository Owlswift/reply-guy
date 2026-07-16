#!/bin/bash

# Supervises `npm run start:interactive`, restarting it whenever it exits.
#
# The bot's watchdog hard-exits the process if it detects the browser/CDP
# connection has hung (no log activity for 3+ minutes) instead of trying to
# recover in place — this script is what actually brings it back up, with a
# fresh CDP connection to the still-running Chrome instance.

cd "$(dirname "$0")/.."

RESTART_DELAY_SECONDS=5

echo "=== Echo supervisor started (restarts on any exit, ${RESTART_DELAY_SECONDS}s delay) ==="

while true; do
  npm run start:interactive
  exit_code=$?
  echo ""
  echo "=== Echo exited (code $exit_code) at $(date '+%Y-%m-%d %H:%M:%S') — restarting in ${RESTART_DELAY_SECONDS}s ==="
  sleep "$RESTART_DELAY_SECONDS"
done
