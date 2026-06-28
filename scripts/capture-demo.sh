#!/usr/bin/env bash
# Capture the jiko idle-face demo (apps/web/demo.html) and each of its four boxes
# as PNGs under docs/assets/demo/. Renders the real React screen via headless
# Chrome at 2x, so the output is pixel-identical to the live device's idle face.
#
# Prereqs: the web dev server on :5173 (pnpm dev:web), Google Chrome, and sips
# (built into macOS).
# Usage:   pnpm dev:web &   # if not already running
#          scripts/capture-demo.sh
#
# Why render-large-then-crop: headless Chrome clamps the window to a platform
# minimum width and won't reliably exit when --virtual-time-budget is set. So each
# shot renders at one generous, centered viewport (content is centered by the demo
# CSS), is hard-stopped once the PNG is stable, then cropped to the box with sips.
set -uo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE="http://localhost:5173/demo.html"
OUT="docs/assets/demo"
WIN="800,680"   # CSS px; 1600x1360 image at 2x. Larger than any box, so all center.

cd "$(dirname "$0")/.."
mkdir -p "$OUT"

# render <url-query> <out-png> : screenshot the demo at WIN, centered, then stop Chrome.
render() {
  local profile="$1" query="$2" out="$3" last=0 stable=0 cur
  rm -f "$out"
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=2 \
    --no-first-run --no-default-browser-check --disable-gpu \
    --user-data-dir="$profile" --virtual-time-budget=2500 \
    --window-size="$WIN" --screenshot="$out" "$BASE$query" >/dev/null 2>&1 &
  for _ in $(seq 1 80); do
    if [ -f "$out" ]; then
      cur=$(stat -f%z "$out" 2>/dev/null || echo 0)
      if [ "$cur" -gt 1000 ] && [ "$cur" -eq "$last" ]; then
        stable=$((stable + 1)); [ "$stable" -ge 2 ] && break
      else stable=0; fi
      last=$cur
    fi
    sleep 0.25
  done
  pkill -f "$profile" 2>/dev/null
  sleep 0.3
}

# shoot <name> <query> <cropH> <cropW> : render, then center-crop to box size (2x px).
shoot() {
  local profile out
  profile="$(mktemp -d)"
  out="$OUT/$1.png"
  render "$profile" "$2" "$out"
  if [ -n "${3:-}" ]; then
    sips -c "$3" "$4" "$out" --out "$out" >/dev/null
  fi
  rm -rf "$profile"
  echo "  $out -> $(file "$out" | sed 's/.*PNG image data, //; s/,.*//')"
}

echo "Capturing jiko demo →"
shoot jiko-idle-face    "?only=all"    1100 720
shoot jiko-box-1-clock  "?only=clock"   260 640
shoot jiko-box-2-king   "?only=king"    360 360
shoot jiko-box-3-tree   "?only=tree"    360 360
shoot jiko-box-4-oracle "?only=oracle"  360 360
echo "Done."
