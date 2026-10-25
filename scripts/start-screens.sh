#!/bin/bash
# Opens one full-screen window per display on the Mac mini's outputs, using
# the list in scripts/screens.conf. Runs at login (see install-mac.sh), and can
# be run by hand to reopen everything:  bash scripts/start-screens.sh
cd "$(dirname "$0")/.."
CONF="scripts/screens.conf"
[ -f "$CONF" ] || CONF="scripts/screens.example.conf"
PORT="$(node -e "try{console.log(require('./data/config.json').port||8080)}catch(e){console.log(8080)}" 2>/dev/null || echo 8080)"
BASE="http://localhost:$PORT"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "Google Chrome isn't installed. Install it from https://www.google.com/chrome and run this again."
  exit 1
fi

# Wait for the display server to answer (up to 2 minutes after login).
for i in $(seq 1 60); do
  curl -s -o /dev/null "$BASE/api/displays" && break
  sleep 2
done

# Close windows a previous run opened.
pkill -f "lcd-screen-" 2>/dev/null || true
sleep 1

n=0
grep -v '^\s*#' "$CONF" | while read -r PROFILE X Y; do
  [ -z "$PROFILE" ] && continue
  n=$((n + 1))
  DIR="$HOME/Library/Application Support/lcd-screen-$PROFILE"
  "$CHROME" \
    --user-data-dir="$DIR" \
    --app="$BASE/display/$PROFILE" \
    --window-position="${X:-0},${Y:-0}" \
    --window-size=1920,1080 \
    --start-fullscreen \
    --kiosk \
    --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble \
    --disable-features=Translate --autoplay-policy=no-user-gesture-required \
    >/dev/null 2>&1 &
  echo "Opened $PROFILE at ${X:-0},${Y:-0}"
  sleep 3
done
