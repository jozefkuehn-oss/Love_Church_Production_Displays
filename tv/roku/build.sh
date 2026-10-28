#!/bin/bash
# Builds the Roku TV app and (optionally) installs it on the TV.
#
#   bash tv/roku/build.sh <mac-address:port> [roku-ip] [dev-password]
#   e.g.  bash tv/roku/build.sh http://192.168.10.50:8080 192.168.10.249 mypassword
#
# The Roku has to be in developer mode first (see docs/TV-SETUP.md → Roku).
# Without an IP it just builds the zip, which you can upload yourself at
# http://<roku-ip> in a browser.
set -e
cd "$(dirname "$0")"
SERVER="${1:?Give the display server address, e.g. http://192.168.10.50:8080}"
IP="$2"
PASS="$3"
OUT="$(pwd)/build"
rm -rf "$OUT" && mkdir -p "$OUT/src"
cp -R source components images "$OUT/src/"
sed "s#^server=.*#server=${SERVER%/}#" manifest > "$OUT/src/manifest"
( cd "$OUT/src" && zip -qr "$OUT/LC_Displays_Roku.zip" manifest source components images )
echo "Built $OUT/LC_Displays_Roku.zip"
if [ -n "$IP" ]; then
  [ -n "$PASS" ] || read -r -s -p "Roku developer password: " PASS && echo
  curl -sS --user "rokudev:$PASS" --digest -F "mysubmit=Install" -F "archive=@$OUT/LC_Displays_Roku.zip" "http://$IP/plugin_install" | grep -oE 'Install Success|Identical to previous version|Install Failure[^<]*' || true
fi
