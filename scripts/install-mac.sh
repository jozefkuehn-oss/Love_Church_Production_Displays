#!/bin/bash
# One-time install on the Mac mini. Run from the project folder:
#   bash scripts/install-mac.sh
# Sets the display server to start at login and restart itself if it ever stops.
set -e
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
LABEL="org.lovechurch.displays"
AGENTS="$HOME/Library/LaunchAgents"
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "Node.js isn't installed yet."
  echo "Download the macOS installer (LTS) from https://nodejs.org, run it, then run this script again."
  exit 1
fi
echo "Using Node $("$NODE" -v) at $NODE"

echo "Installing the app's packages…"
npm install --omit=dev --no-audit --no-fund

mkdir -p "$AGENTS" "$APP_DIR/data/logs"

cat > "$AGENTS/$LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$APP_DIR/server/index.js</string></array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP_DIR/data/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/data/logs/launchd.err.log</string>
</dict>
</plist>
PLIST

cat > "$AGENTS/$LABEL.screens.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL.screens</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$APP_DIR/scripts/start-screens.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$APP_DIR/data/logs/screens.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/data/logs/screens.log</string>
</dict>
</plist>
PLIST

launchctl unload "$AGENTS/$LABEL.plist" 2>/dev/null || true
launchctl load "$AGENTS/$LABEL.plist"
echo "Display server installed and started."

if [ ! -f "$APP_DIR/scripts/screens.conf" ]; then
  cp "$APP_DIR/scripts/screens.example.conf" "$APP_DIR/scripts/screens.conf"
fi
launchctl unload "$AGENTS/$LABEL.screens.plist" 2>/dev/null || true
launchctl load "$AGENTS/$LABEL.screens.plist"
echo "Screens will open automatically at login (edit scripts/screens.conf to choose which)."

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 'this-mac')"
PORT="$(node -e "try{console.log(require('./data/config.json').port||8080)}catch(e){console.log(8080)}")"
echo ""
echo "Done. Open the admin page from any phone or computer on the church network:"
echo "    http://$IP:$PORT/admin"
echo "Displays:  http://$IP:$PORT/display"
