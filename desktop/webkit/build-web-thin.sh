#!/usr/bin/env bash
# Builds the web-thin macOS app: the same WebKit (WKWebView) shell as build.sh, but with no bundled game —
# Info.plist MK64WebURL points it at the hosted game. Signs, optionally notarizes, and zips it.
# Usage: ./build-web-thin.sh [notarize]   (no `npm run game` needed)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('$HERE/../package.json').version")
URL="${MK64_WEB_URL:-https://mk64js.gokart.games/play}"
APP="$HERE/build/web-thin/MarioKart64JS Web.app"
ZIP="$HERE/../release/MarioKart64JS-web-thin-$VERSION-mac-universal.zip"
IDENTITY="Developer ID Application: Todd Bruss (469UCUB275)"

swift build --package-path "$HERE" -c release --arch arm64 --arch x86_64
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$(swift build --package-path "$HERE" -c release --arch arm64 --arch x86_64 --show-bin-path)/MarioKart64JS" "$APP/Contents/MacOS/"
cp "$HERE/MK64JS.icns" "$APP/Contents/Resources/"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MarioKart64JS Web</string>
  <key>CFBundleExecutable</key><string>MarioKart64JS</string>
  <key>CFBundleIconFile</key><string>MK64JS</string>
  <key>CFBundleIdentifier</key><string>games.gokart.mariokart64js.webthin</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.games</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>MK64WebURL</key><string>$URL</string>
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
