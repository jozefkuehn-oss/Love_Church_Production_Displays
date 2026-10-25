#!/bin/bash
# Pull the latest version from GitHub and restart. Your settings, accounts,
# photos and messages live in ./data and are never touched by updates.
#   bash scripts/update.sh
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
npm install --omit=dev --no-audit --no-fund
launchctl kickstart -k "gui/$(id -u)/org.lovechurch.displays"
echo "Updated and restarted. Screens reconnect on their own within a few seconds."
