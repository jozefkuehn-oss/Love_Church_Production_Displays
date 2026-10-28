#!/bin/bash
# Builds and installs the Samsung TV dashboard app.
#
#   bash tv/samsung/build.sh <mac-address:port> <certificate-profile> [tv-ip ...]
#   e.g.  bash tv/samsung/build.sh http://192.168.10.50:8080 LoveChurch 192.168.10.61 192.168.10.62
#
# Needs Tizen Studio (with the TV extensions and Samsung Certificate Manager)
# on this Mac. See docs/TV-SETUP.md → Samsung for the one-time setup.
set -e
cd "$(dirname "$0")"
SERVER="${1:?Give the display server address, e.g. http://192.168.10.50:8080}"
PROFILE="${2:?Give the Tizen certificate profile name}"
shift 2
TIZEN="${TIZEN:-$HOME/tizen-studio/tools/ide/bin/tizen}"
SDB="${SDB:-$HOME/tizen-studio/tools/sdb}"
[ -x "$TIZEN" ] || { echo "Can't find Tizen Studio's tizen tool at $TIZEN (set TIZEN=/path/to/tizen)."; exit 1; }

OUT="$(pwd)/build"
rm -rf "$OUT" && mkdir -p "$OUT/src"
cp config.xml index.html app.js icon.png "$OUT/src/"
echo "window.LCD_SERVER = '${SERVER%/}';" > "$OUT/src/config.js"

"$TIZEN" package -t wgt -s "$PROFILE" -o "$OUT" -- "$OUT/src"
WGT="$(ls "$OUT"/*.wgt | head -1)"
echo "Built $WGT"

for IP in "$@"; do
  echo "Installing on $IP…"
  "$SDB" connect "$IP"
  SERIAL="$("$SDB" devices | awk -v ip="$IP" 'index($1, ip) {print $3; exit}')"
  "$TIZEN" install -n "$(basename "$WGT")" -t "${SERIAL:-$IP:26101}" -- "$OUT"
  "$SDB" disconnect "$IP" >/dev/null 2>&1 || true
done
echo "Done."
