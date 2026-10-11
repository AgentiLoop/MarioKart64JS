#!/usr/bin/env bash
# Packages the web-thin Raspberry Pi (Linux) app: the same mk64js.py GTK + WebKitGTK shell as build.sh, but with
# no bundled game — the launcher passes the hosted game URL. Includes install-webkit.sh to apt-install WebKitGTK.
# Usage: ./build-web-thin.sh   (no `npm run game` needed)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('$HERE/../package.json').version")
URL="${MK64_WEB_URL:-https://mk64js.gokart.games/play}"
STAGE="$HERE/build/web-thin/MarioKart64JS-web-thin"
TGZ="$HERE/../release/MarioKart64JS-web-thin-$VERSION-raspberrypi.tar.gz"

rm -rf "$HERE/build/web-thin"; mkdir -p "$STAGE"
cp "$HERE/mk64js.py" "$HERE/../icon/MK64JS.png" "$STAGE/"
cp "$HERE/README-web-thin.txt" "$STAGE/README.txt"
cat > "$STAGE/MarioKart64JS" <<SH
#!/bin/sh
exec python3 "\$(dirname "\$(readlink -f "\$0")")/mk64js.py" "\${MK64_WEB_URL:-$URL}" "\$@"
SH
cat > "$STAGE/install-webkit.sh" <<'SH'
#!/bin/sh
# Installs the system WebKitGTK webview + Python GTK bindings (Raspberry Pi OS / Debian / Ubuntu).
set -e
sudo apt update
sudo apt install -y python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 \
  || sudo apt install -y python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.0
sudo apt install -y gstreamer1.0-plugins-good gstreamer1.0-plugins-base || true   # WebAudio output
echo "WebKitGTK installed — run ./MarioKart64JS"
SH
cat > "$STAGE/install-menu-entry.sh" <<'SH'
#!/bin/sh
# Adds MarioKart64JS Web to the desktop's Games menu (~/.local/share/applications).
D="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/mariokart64js-web-thin.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=MarioKart64JS Web
Exec="$D/MarioKart64JS"
Icon=$D/MK64JS.png
Categories=Game;
EOF
echo "MarioKart64JS Web added to the Games menu"
SH
chmod +x "$STAGE/MarioKart64JS" "$STAGE/install-webkit.sh" "$STAGE/install-menu-entry.sh" "$STAGE/mk64js.py"
mkdir -p "$(dirname "$TGZ")"; rm -f "$TGZ"
COPYFILE_DISABLE=1 tar -czf "$TGZ" -C "$HERE/build/web-thin" MarioKart64JS-web-thin
ls -la "$TGZ"
