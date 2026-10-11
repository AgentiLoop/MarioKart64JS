#!/usr/bin/env bash
# Packages the web-thin Linux app (x64 + arm64 in one tarball): the MarioKart64JS launcher opens the hosted game in a
# Chrome / Chromium app window (WebKitGTK mk64js.py as fallback); install.sh installs a browser if needed + menu entry.
# Usage: ./build-web-thin.sh   (no `npm run game` needed)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('$HERE/../package.json').version")
URL="${MK64_WEB_URL:-https://mk64js.gokart.games/play}"
STAGE="$HERE/build/web-thin/MarioKart64JS-web-thin"
TGZ="$HERE/../release/MarioKart64JS-web-thin-$VERSION-linux.tar.gz"

rm -rf "$HERE/build/web-thin"; mkdir -p "$STAGE"
cp "$HERE/MarioKart64JS" "$HERE/install.sh" "$HERE/../raspberrypi/mk64js.py" "$HERE/../icon/MK64JS.png" "$STAGE/"
cp "$HERE/README-web-thin.txt" "$STAGE/README.txt"
echo "$URL" > "$STAGE/url.txt"
chmod +x "$STAGE/MarioKart64JS" "$STAGE/install.sh" "$STAGE/mk64js.py"
mkdir -p "$(dirname "$TGZ")"; rm -f "$TGZ"
COPYFILE_DISABLE=1 tar -czf "$TGZ" -C "$HERE/build/web-thin" MarioKart64JS-web-thin
ls -la "$TGZ"
