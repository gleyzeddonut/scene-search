#!/usr/bin/env bash
# Build the signed, notarized Scripty .dmgs (arm64 + x64). Pure JS — no engine binary.
#   ./packaging/build_app.sh                 # build only (app/dist/)
#   PUBLISH=always ./packaging/build_app.sh  # build + publish to GitHub releases
#                                            # (needs: export GH_TOKEN=$(gh auth token))
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && cd .. && pwd)"
cd "$ROOT/app"
PUBLISH="${PUBLISH:-never}"

# start from a clean dist/ so old version artifacts (DMGs/zips) don't pile up
rm -rf dist

# Build the universal macOS OCR helper (Vision + PDFKit) bundled with the app, so
# scanned/photographed scripts can be read. Optional: the app runs fine without it.
echo "Building OCR helper (universal)…"
swiftc -O -target arm64-apple-macos11 "$ROOT/packaging/ocr/ocr.swift" -o /tmp/scripty-ocr-arm64
swiftc -O -target x86_64-apple-macos11 "$ROOT/packaging/ocr/ocr.swift" -o /tmp/scripty-ocr-x64
lipo -create /tmp/scripty-ocr-arm64 /tmp/scripty-ocr-x64 -output resources/scripty-ocr
# pre-sign with hardened runtime so notarization accepts it (electron-builder re-signs too)
codesign --force --options runtime --timestamp -s "Daniel Gleyzer (K7VM2MP885)" resources/scripty-ocr

npx electron-vite build && npx electron-builder --mac --arm64 --x64 --publish "$PUBLISH"
echo ""
echo "Done. Distributables in app/dist/:"
ls -1 dist/*.dmg 2>/dev/null || true
