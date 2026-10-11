#!/bin/sh
# One-step install of MarioKart64JS Web for Linux (x64 and arm64, Raspberry Pi included):
#   1. installs a browser if no Chrome / Chromium / Edge / Brave is found:
#      Google Chrome on x64 (apt / dnf), Chromium on arm64 and other distros
#   2. copies the app to ~/.local/share/mariokart64js-web/app
#   3. adds "MarioKart64JS Web" to the Games menu and a `mariokart64js-web` command in ~/.local/bin
#   4. starts the game
# ./install.sh --no-launch skips step 4; ./install.sh --uninstall removes everything (settings included).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
HOME_DIR="$DATA/mariokart64js-web"
APP="$HOME_DIR/app"
DESK="$DATA/applications/mariokart64js-web.desktop"
BIN="$HOME/.local/bin/mariokart64js-web"

if [ "${1:-}" = --uninstall ]; then
  rm -rf "$HOME_DIR" "$HOME/snap/chromium/common/mariokart64js-web" "$DESK" "$BIN"
  echo "MarioKart64JS Web removed"
  exit 0
fi

has_browser() {
  for b in google-chrome-stable google-chrome chromium chromium-browser microsoft-edge-stable microsoft-edge \
           brave-browser; do
    command -v "$b" >/dev/null 2>&1 && return 0
  done
  command -v flatpak >/dev/null 2>&1 && { flatpak info org.chromium.Chromium || flatpak info com.google.Chrome; } \
    >/dev/null 2>&1 && return 0
  return 1
}

if ! has_browser; then
  SUDO=; [ "$(id -u)" = 0 ] || SUDO=sudo
  ARCH="$(uname -m)"
  TMP="$(mktemp -d)"
  echo "No Chrome or Chromium found, installing one (asks for your password)"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    if [ "$ARCH" = x86_64 ]; then
      DEB=https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
      curl -fsSL -o "$TMP/chrome.deb" "$DEB" 2>/dev/null || wget -qO "$TMP/chrome.deb" "$DEB"
      $SUDO apt-get install -y "$TMP/chrome.deb"
    else
      $SUDO apt-get install -y chromium || $SUDO apt-get install -y chromium-browser
    fi
  elif command -v dnf >/dev/null 2>&1; then
    if [ "$ARCH" = x86_64 ]; then
      $SUDO dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
    else
      $SUDO dnf install -y chromium
    fi
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -S --needed --noconfirm chromium
  elif command -v zypper >/dev/null 2>&1; then
    $SUDO zypper --non-interactive install chromium
  else
    echo "Install Google Chrome or Chromium with your package manager, then run ./install.sh again" >&2
    exit 1
  fi
  rm -rf "$TMP"
fi

if [ "$SRC" != "$APP" ]; then
  rm -rf "$APP"; mkdir -p "$APP"
  cp -R "$SRC/." "$APP/"
fi
mkdir -p "$(dirname "$DESK")" "$(dirname "$BIN")"
ln -sf "$APP/MarioKart64JS" "$BIN"
cat > "$DESK" <<EOF
[Desktop Entry]
Type=Application
Name=MarioKart64JS Web
Comment=Mario Kart 64 in your browser (mk64js.gokart.games)
Exec="$APP/MarioKart64JS"
Icon=$APP/MK64JS.png
Categories=Game;
StartupWMClass=MarioKart64JS-Web
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESK")" 2>/dev/null || true
echo "MarioKart64JS Web installed: Games menu entry added, or run: mariokart64js-web"

if [ "${1:-}" != --no-launch ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  nohup "$APP/MarioKart64JS" >/dev/null 2>&1 &
fi
