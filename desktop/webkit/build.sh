#!/usr/bin/env bash
# Builds a small WebKit (WKWebView) macOS app around desktop/game, signs, notarizes and zips it.
# Usage: ./build.sh [notarize]   (run `npm run game` in desktop/ first)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('$HERE/../package.json').version")
GAME="$HERE/../game"
APP="$HERE/build/MarioKart64JS.app"
ZIP="$HERE/../release/MarioKart64JS-$VERSION-mac-webkit-universal.zip"
IDENTITY="Developer ID Application: Todd Bruss (469UCUB275)"

[ -f "$GAME/index.html" ] || { echo "error: $GAME missing — run 'npm run game' in desktop/" >&2; exit 1; }

swift build --package-path "$HERE" -c release --arch arm64 --arch x86_64
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$(swift build --package-path "$HERE" -c release --arch arm64 --arch x86_64 --show-bin-path)/MarioKart64JS" "$APP/Contents/MacOS/"
rsync -a --exclude .DS_Store "$GAME/" "$APP/Contents/Resources/game/"
cp "$HERE/MK64JS.icns" "$APP/Contents/Resources/"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MarioKart64JS</string>
  <key>CFBundleExecutable</key><string>MarioKart64JS</string>
  <key>CFBundleIconFile</key><string>MK64JS</string>
  <key>CFBundleIdentifier</key><string>games.gokart.mariokart64js.webkit</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.games</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
codesign --verify --strict --verbose=2 "$APP"
mkdir -p "$(dirname "$ZIP")"; rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
if [ "${1:-}" = notarize ]; then
  xcrun notarytool submit "$ZIP" -p "App Store Connect Profile" --wait
  xcrun stapler staple "$APP"
  rm -f "$ZIP"; ditto -c -k --keepParent "$APP" "$ZIP"
  spctl -a -vv "$APP"
fi
ls -la "$ZIP"
