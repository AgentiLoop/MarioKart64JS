#!/usr/bin/env bash
# Packages the web-thin Windows app (x64 + ARM64 in one zip): mk64js-web.ps1 opens the hosted game in a Microsoft
# Edge app window, so nothing is compiled or bundled. Install.cmd / MarioKart64JS.cmd / Uninstall.cmd wrap it.
# Usage: ./build-web-thin.sh   (no `npm run game` needed)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('$HERE/../package.json').version")
URL="${MK64_WEB_URL:-https://mk64js.gokart.games/play}"
STAGE="$HERE/build/web-thin/MarioKart64JS-web-thin"
ZIP="$HERE/../release/MarioKart64JS-web-thin-$VERSION-win.zip"

crlf() { sed 's/$/\r/'; }   # .cmd/.ps1/.txt with Windows line endings
rm -rf "$HERE/build/web-thin"; mkdir -p "$STAGE"
cp "$HERE/MK64JS.ico" "$STAGE/"
crlf < "$HERE/mk64js-web.ps1" > "$STAGE/mk64js-web.ps1"
crlf < "$HERE/README-web-thin.txt" > "$STAGE/README.txt"
printf '%s\r\n' "$URL" > "$STAGE/url.txt"
cmd() { printf '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%%~dp0mk64js-web.ps1" %s\r\n%s\r\n' "$1" "$2" > "$STAGE/$3"; }
cmd ''           'if errorlevel 1 pause' Install.cmd
cmd '-Run'       'if errorlevel 1 pause' MarioKart64JS.cmd
cmd '-Uninstall' 'pause'                 Uninstall.cmd
mkdir -p "$(dirname "$ZIP")"; rm -f "$ZIP"
(cd "$HERE/build/web-thin" && zip -qrX "$ZIP" MarioKart64JS-web-thin)
ls -la "$ZIP"
