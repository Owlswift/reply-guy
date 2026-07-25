#!/bin/bash

# Supervises `npm run start:interactive`, restarting it whenever it exits.
#
# The bot's watchdog hard-exits the process if it detects the browser/CDP
# connection has hung (no log activity for 3+ minutes) instead of trying to
# recover in place — this script is what actually brings it back up, with a
# fresh CDP connection to the still-running Chrome instance.

cd "$(dirname "$0")/.."

RESTART_DELAY_SECONDS=5

# Hold the Mac awake for as long as this supervisor itself is alive (tied to
# this script's own PID via -w, so it releases automatically whenever the
# supervisor exits, restart delay included). Confirmed via `pmset -g log`
# that a real outage was caused by the whole machine going into Deep Idle —
# launchd's ensure-running.sh timer can't fire while the system is fully
# asleep, so the crashed bot just stayed down until a human woke the Mac.
# No amount of restart logic fixes that; the machine has to stay awake.
caffeinate -dims -w $$ &

echo "=== Echo supervisor started (restarts on any exit, ${RESTART_DELAY_SECONDS}s delay) ==="

while true; do
  npm run start:interactive
  exit_code=$?
  echo ""
  echo "=== Echo exited (code $exit_code) at $(date '+%Y-%m-%d %H:%M:%S') — restarting in ${RESTART_DELAY_SECONDS}s ==="
  sleep "$RESTART_DELAY_SECONDS"
done
