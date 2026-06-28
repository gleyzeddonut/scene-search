#!/usr/bin/env bash
# Generate app/build/icon.icns from app/build/icon.png (1024x1024).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/app/build/icon.png"
SET="$(mktemp -d)/icon.iconset"
mkdir -p "$SET"

gen() { sips -z "$1" "$1" "$SRC" --out "$SET/icon_${2}.png" >/dev/null; }
gen 16   16x16
gen 32   16x16@2x
gen 32   32x32
gen 64   32x32@2x
gen 128  128x128
gen 256  128x128@2x
gen 256  256x256
gen 512  256x256@2x
gen 512  512x512
cp "$SRC" "$SET/icon_512x512@2x.png"

iconutil -c icns "$SET" -o "$ROOT/app/build/icon.icns"
echo "wrote app/build/icon.icns"
