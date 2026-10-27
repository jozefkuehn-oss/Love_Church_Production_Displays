#!/bin/bash
# Update the display app to the newest version on GitHub, then restart it.
#
#   Double-click "Update Displays.command"   (or: bash scripts/update.sh)
#
# Your settings, PINs, people photos, dashboards you changed on this Mac and
# today's messages all live in the "data" folder. Updates never touch it, and
# a backup copy is made first (data-backups/), just in case.
#
# Works whether this folder came from the GitHub zip or from "git clone".
# --from-app : started by the Update button in Admin → Settings (no prompts).

# Run from a temporary copy, because this very file gets replaced during the update.
if [ -z "$LCD_UPDATE_COPY" ]; then
  COPY="$(mktemp "${TMPDIR:-/tmp}/lcd-update.XXXXXX")"
  cp "$0" "$COPY"
  LCD_UPDATE_COPY=1 LCD_APP_DIR="$(cd "$(dirname "$0")/.." && pwd)" exec bash "$COPY" "$@"
fi

REPO="jozefkuehn-oss/Love_Church_Production_Displays"
BRANCH="main"
LABEL="org.lovechurch.displays"
FROM_APP=0
[ "$1" = "--from-app" ] && FROM_APP=1

cd "$LCD_APP_DIR" || exit 1
APP_DIR="$(pwd)"
LOG="$APP_DIR/data/logs/update.log"
mkdir -p "$APP_DIR/data/logs"
if [ $FROM_APP -eq 1 ]; then exec >>"$LOG" 2>&1; fi
say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { say "UPDATE FAILED: $*"; say "Nothing was changed. The app keeps running the version it had."; exit 1; }

say "Updating Love Church Displays in $APP_DIR"

# 1. Back up the data folder (keep the 5 newest backups).
if [ -d "$APP_DIR/data" ]; then
  mkdir -p "$APP_DIR/data-backups"
  STAMP="$(date '+%Y%m%d-%H%M%S')"
  tar -czf "$APP_DIR/data-backups/data-$STAMP.tgz" --exclude 'logs' -C "$APP_DIR" data || fail "couldn't back up the data folder"
  ls -1t "$APP_DIR"/data-backups/data-*.tgz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null
  say "Backed up data → data-backups/data-$STAMP.tgz"
fi

# 2. Get the newest code.
LATEST_SHA="$(curl -fsSL "https://api.github.com/repos/$REPO/commits/$BRANCH" 2>/dev/null | grep -m1 '"sha"' | sed -E 's/.*"sha": *"([0-9a-f]+)".*/\1/')"
[ -z "$LATEST_SHA" ] && LATEST_SHA="$(curl -fsSL "https://github.com/$REPO/commits/$BRANCH.atom" 2>/dev/null | grep -m1 -oE 'Commit/[0-9a-f]{40}' | cut -d/ -f2)"
if [ -d "$APP_DIR/.git" ] && command -v git >/dev/null; then
  say "Getting the newest version with git…"
  git pull --ff-only || fail "git pull didn't work (were files changed by hand in this folder?)"
  LATEST_SHA="$(git rev-parse HEAD)"
else
  say "Downloading the newest version from GitHub…"
  TMP="$(mktemp -d)"
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip" -o "$TMP/app.zip" || fail "couldn't download from GitHub (is this Mac online?)"
  unzip -q "$TMP/app.zip" -d "$TMP" || fail "the download was damaged"
  SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -f "$SRC/server/index.js" ] || fail "the download didn't look like the display app"
  # Replace the app files. Keep data, backups, packages and this Mac's screen list.
  KEEP_CONF=""
  [ -f "$APP_DIR/scripts/screens.conf" ] && KEEP_CONF="$(cat "$APP_DIR/scripts/screens.conf")"
  for f in "$APP_DIR"/* "$APP_DIR"/.[!.]*; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in data|data-backups|node_modules|.git) continue ;; esac
    rm -rf "$f"
  done
  cp -R "$SRC/." "$APP_DIR/" || fail "couldn't copy the new files (restore from data-backups if the app won't start)"
  [ -n "$KEEP_CONF" ] && printf '%s\n' "$KEEP_CONF" > "$APP_DIR/scripts/screens.conf"
  rm -rf "$TMP"
fi
[ -n "$LATEST_SHA" ] && echo "{\"sha\":\"$LATEST_SHA\",\"updatedAt\":\"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\"}" > "$APP_DIR/data/version.json"
chmod +x "$APP_DIR"/*.command "$APP_DIR"/scripts/*.sh 2>/dev/null
xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null

# 3. Packages (only downloads anything when the app needs something new).
say "Checking the app's packages…"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || say "Note: npm install had a problem; the app may still work. See README."

# 4. Restart.
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  say "Done. The app restarted itself; screens reconnect within a few seconds."
else
  PIDS="$(pgrep -f "$APP_DIR/server/index.js|node server/index.js" || true)"
  if [ -n "$PIDS" ]; then
    kill $PIDS 2>/dev/null
    say "Done. The app was stopped so the new version can start:"
    say "double-click \"Start Displays (beta).command\" to start it again."
  else
    say "Done. Start the app the usual way."
  fi
fi

if [ $FROM_APP -eq 0 ]; then
  echo ""
  read -r -p "Press Return to close this window." _
fi
