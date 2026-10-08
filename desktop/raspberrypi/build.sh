#!/usr/bin/env bash
# Packages the Raspberry Pi (Linux) webview app: mk64js.py (GTK + system WebKitGTK) around desktop/game.
# Usage: ./build.sh   (run `npm run game` in desktop/ first)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('$HERE/../package.json').version")
GAME="$HERE/../game"
STAGE="$HERE/build/MarioKart64JS"
TGZ="$HERE/../release/MarioKart64JS-$VERSION-raspberrypi.tar.gz"

[ -f "$GAME/index.html" ] || { echo "error: $GAME missing — run 'npm run game' in desktop/" >&2; exit 1; }

rm -rf "$HERE/build"; mkdir -p "$STAGE"
rsync -a --exclude .DS_Store "$GAME/" "$STAGE/game/"
cp "$HERE/mk64js.py" "$HERE/../icon/MK64JS.png" "$HERE/README.txt" "$STAGE/"
cat > "$STAGE/MarioKart64JS" <<'SH'
#!/bin/sh
exec python3 "$(dirname "$(readlink -f "$0")")/mk64js.py" "$@"
SH
cat > "$STAGE/install-menu-entry.sh" <<'SH'
#!/bin/sh
# Adds MarioKart64JS to the desktop's Games menu (~/.local/share/applications).
D="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/mariokart64js.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=MarioKart64JS
Exec="$D/MarioKart64JS"
Icon=$D/MK64JS.png
Categories=Game;
EOF
echo "MarioKart64JS added to the Games menu"
SH
chmod +x "$STAGE/MarioKart64JS" "$STAGE/install-menu-entry.sh" "$STAGE/mk64js.py"
mkdir -p "$(dirname "$TGZ")"; rm -f "$TGZ"
COPYFILE_DISABLE=1 tar -czf "$TGZ" -C "$HERE/build" MarioKart64JS
ls -la "$TGZ"
