#!/usr/bin/env bash
#
# Build, Developer-ID-sign, notarize, and staple Scene Search into a
# distributable .zip.
#
# Prerequisites (one-time):
#   1. A "Developer ID Application" certificate in your login keychain.
#   2. Stored notarization credentials, created with:
#        xcrun notarytool store-credentials "scene-search-notary" \
#          --apple-id "you@example.com" \
#          --team-id "K7VM2MP885" \
#          --password "<app-specific-password>"
#
# Usage (from the project root):
#   ./packaging/build_release.sh
#
set -euo pipefail

APP_NAME="Scripty"
IDENTITY="Developer ID Application: Daniel Gleyzer (K7VM2MP885)"
KEYCHAIN_PROFILE="${NOTARY_PROFILE:-scene-search-notary}"
# Which venv to build from. Default is the arm64 venv; set VENV=.venv-intel to
# build the x86_64 (Intel) app via Rosetta.
VENV="${VENV:-.venv}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENTITLEMENTS="packaging/entitlements.plist"
APP="dist/${APP_NAME}.app"

echo "==> Cleaning previous build (keeping other arch's distributable zips)"
rm -rf build "$APP" "dist/${APP_NAME}-notarize.zip"
mkdir -p dist

echo "==> Building .app with PyInstaller (venv: $VENV)"
"$VENV/bin/pyinstaller" "packaging/${APP_NAME}.spec" --noconfirm

# Name the distributable by the arch actually baked into the binary.
APP_ARCH="$(lipo -archs "$APP/Contents/MacOS/${APP_NAME}" | tr ' ' '-')"
DIST_ZIP="dist/${APP_NAME// /-}-macOS-${APP_ARCH}.zip"
echo "==> Built architecture: $APP_ARCH"

echo "==> Signing every nested Mach-O binary (inside-out, frameworks included)"
# Frameworks store their binary at Versions/A/<Name> with NO extension, so we
# detect Mach-O files by content (via `file`), not by name. Sign deepest paths
# first so nested code is sealed before its container.
while IFS= read -r macho; do
    codesign --force --options runtime --timestamp --sign "$IDENTITY" "$macho"
done < <(
    find "$APP/Contents" -type f -print0 \
        | xargs -0 file \
        | grep -E 'Mach-O' \
        | sed 's/: *Mach-O.*//' \
        | awk '{ print length, $0 }' \
        | sort -rn \
        | cut -d' ' -f2-
)

echo "==> Signing the app bundle with entitlements"
codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" "$APP"

echo "==> Verifying signature"
codesign --verify --strict --verbose=2 "$APP"

echo "==> Zipping for notarization"
NOTARIZE_ZIP="dist/${APP_NAME}-notarize.zip"
ditto -c -k --keepParent "$APP" "$NOTARIZE_ZIP"

echo "==> Submitting to Apple notary service (this can take a few minutes)"
xcrun notarytool submit "$NOTARIZE_ZIP" \
    --keychain-profile "$KEYCHAIN_PROFILE" --wait

echo "==> Stapling the notarization ticket"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

echo "==> Producing distributable zip"
rm -f "$NOTARIZE_ZIP"
ditto -c -k --keepParent "$APP" "$DIST_ZIP"

echo ""
echo "Done. Send her: $DIST_ZIP"
echo "She unzips it and double-clicks Scene Search.app — no warnings."
