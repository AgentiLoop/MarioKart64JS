#!/usr/bin/env bash
# Cuts a MarioKart64JS release end to end:
#   bump desktop/package.json -> commit "Release X" -> push origin main -> deploy the site (/play)
#   -> build the desktop apps (Electron win/linux, notarized WebKit mac, Raspberry Pi) and the web-thin apps
#   -> SHA256SUMS -> GitHub release (notes and Z* screenshots taken from the previous release)
#   -> delete older releases nobody downloaded (tools/prune-releases.sh).
#
# Usage: tools/release.sh <whats-new.md> [version]
#   whats-new.md  bullet list for "What's new since <previous>" (markdown, without the heading)
#   version       defaults to the next patch version (0.0.20 -> 0.0.21)
# Env: DRY_RUN=1   print the plan and the release notes, change nothing
#      SKIP_BUILD=1 reuse artifacts already in desktop/release for this version
#      NO_PRUNE=1   keep the 0-download releases
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO=AgentiLoop/MarioKart64JS
NOTES_IN="${1:?usage: tools/release.sh <whats-new.md> [version]}"
[ -f "$NOTES_IN" ] || { echo "error: $NOTES_IN not found" >&2; exit 1; }
NOTES_IN="$(cd "$(dirname "$NOTES_IN")" && pwd)/$(basename "$NOTES_IN")"
cd "$ROOT"

CUR=$(node -p "require('./desktop/package.json').version")
VER="${2:-$(node -p "const v='$CUR'.split('.'); v[2]=+v[2]+1; v.join('.')")}"
PREV_TAG=$(gh release view -R "$REPO" --json tagName --jq .tagName)   # latest release
PREV="${PREV_TAG#v}"
WORK="/tmp/mk64js-release-$VER"
REL="$ROOT/desktop/release"
mkdir -p "$WORK"
echo "== release $VER (package.json $CUR, previous release $PREV_TAG)"

# release notes: the previous release's body with the version swapped and a new "What's new" section
gh release view "$PREV_TAG" -R "$REPO" --json body --jq .body > "$WORK/prev.md"
python3 - "$WORK/prev.md" "$NOTES_IN" "$PREV" "$VER" "$WORK/notes.md" <<'EOF'
import re, sys
prev, new_in, pv, v, out = sys.argv[1:]
body = open(prev).read().replace(pv, v)
section = f"### ✨ What's new since {pv}\n" + open(new_in).read().strip() + "\n\n"
body, n = re.subn(r"### ✨ What's new since [^\n]*\n.*?(?=\n### |\Z)", section.rstrip("\n") + "\n", body, count=1, flags=re.S)
if not n:
    sys.exit("error: no \"### ✨ What's new since\" section in the previous release notes")
open(out, "w").write(body)
EOF

if [ -n "${DRY_RUN:-}" ]; then
  echo "== DRY_RUN: would bump to $VER, push, deploy /play, build, publish v$VER, prune 0-download releases"
  echo "== notes ($WORK/notes.md):"; cat "$WORK/notes.md"
  exit 0
fi

git diff --quiet && git diff --cached --quiet || { echo "error: working tree not clean" >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "error: not on main" >&2; exit 1; }
gh release view "v$VER" -R "$REPO" >/dev/null 2>&1 && { echo "error: v$VER already exists" >&2; exit 1; }

echo "== bump + push"
if [ "$CUR" != "$VER" ]; then
  sed -i '' "s/\"version\": \"$CUR\"/\"version\": \"$VER\"/" desktop/package.json
  git commit -qm "Release $VER" desktop/package.json
fi
git push -q origin main

echo "== deploy /play"
npm run deploy:web

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "== build"
  (
    cd desktop
    npm run game
    npm run dist
    ./webkit/build.sh notarize
    ./raspberrypi/build.sh
    ./webkit/build-web-thin.sh notarize
    ./windows/build-web-thin.sh
    ./linux/build-web-thin.sh
    ./raspberrypi/build-web-thin.sh
  )
fi

ASSETS=(
  "MarioKart64JS-$VER-linux-arm64.tar.gz" "MarioKart64JS-$VER-linux-x64.tar.gz"
  "MarioKart64JS-$VER-mac-webkit-universal.zip" "MarioKart64JS-$VER-raspberrypi.tar.gz"
  "MarioKart64JS-$VER-win-arm64.zip" "MarioKart64JS-$VER-win-x64.zip"
  "MarioKart64JS-web-thin-$VER-linux.tar.gz" "MarioKart64JS-web-thin-$VER-mac-universal.zip"
  "MarioKart64JS-web-thin-$VER-raspberrypi.tar.gz" "MarioKart64JS-web-thin-$VER-win.zip"
)
for a in "${ASSETS[@]}"; do [ -f "$REL/$a" ] || { echo "error: missing $REL/$a" >&2; exit 1; }; done
(cd "$REL" && shasum -a 256 "${ASSETS[@]}") > "$WORK/SHA256SUMS.txt"

echo "== screenshots from $PREV_TAG"
rm -f "$WORK"/Z*
gh release download "$PREV_TAG" -R "$REPO" -p 'Z*' -D "$WORK"

echo "== publish v$VER"
(cd "$REL" && gh release create "v$VER" -R "$REPO" --target main --title "MarioKart64JS v$VER" \
  --notes-file "$WORK/notes.md" "${ASSETS[@]}" "$WORK/SHA256SUMS.txt" "$WORK"/Z*)

[ -n "${NO_PRUNE:-}" ] || "$ROOT/tools/prune-releases.sh" "v$VER"
echo "== done: https://github.com/$REPO/releases/tag/v$VER"
