#!/usr/bin/env bash
# Deletes every GitHub release (and its assets) whose assets were never downloaded, except the latest release and
# any tags given. The git tags stay.
# Usage: tools/prune-releases.sh [keep-tag ...]     DRY_RUN=1 only lists what would go
set -euo pipefail
REPO=AgentiLoop/MarioKart64JS
LATEST=$(gh release view -R "$REPO" --json tagName --jq .tagName)
KEEP=" $LATEST $* "
gh api "repos/$REPO/releases" --paginate --jq '.[] | "\(.tag_name) \([.assets[].download_count] | add // 0)"' |
while read -r tag downloads; do
  [ "$downloads" = 0 ] || continue
  case "$KEEP" in *" $tag "*) continue ;; esac
  if [ -n "${DRY_RUN:-}" ]; then echo "would delete $tag (0 downloads)"
  else gh release delete "$tag" -R "$REPO" -y && echo "deleted $tag (0 downloads)"; fi
done
