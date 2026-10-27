#!/bin/bash
# Double-click ONCE on the Mac mini to install the display app for good:
# it starts by itself when the Mac starts and restarts itself if it ever stops.
cd "$(dirname "$0")"
bash scripts/install-mac.sh
echo ""
read -r -p "Press Return to close this window." _
