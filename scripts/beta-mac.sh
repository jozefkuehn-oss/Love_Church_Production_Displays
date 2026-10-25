#!/bin/bash
# Beta run on a Mac that already does other work (like the broadcast
# ProPresenter Mac). Runs ONLY the display server, in this Terminal window:
#   • nothing starts at login, nothing opens on this Mac's screens
#   • close the window (or press Control-C) and it's completely stopped
#   • settings and data stay in the app's data folder for next time
# Run from the project folder:
#   bash scripts/beta-mac.sh
set -e
cd "$(dirname "$0")/.."

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js isn't installed yet."
  echo "Download the macOS installer (LTS) from https://nodejs.org, run it, then run this again."
  exit 1
fi

PORT="${PORT:-8080}"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something on this Mac is already using port $PORT."
  echo "Try another port:   PORT=8090 bash scripts/beta-mac.sh"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing the app's packages (first time only)…"
  npm install --omit=dev --no-audit --no-fund
fi

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 'this-mac')"
echo ""
echo "Love Church Displays — BETA"
echo "  Producer app:  http://$IP:$PORT/admin"
echo "  Screens:       http://$IP:$PORT/display"
echo ""
echo "Leave this window open while testing. Close it (or press Control-C) to stop."
echo ""
PORT="$PORT" exec "$NODE" server/index.js
