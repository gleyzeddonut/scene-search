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

APP_NAME="Scene Search"
IDENTITY="Developer ID Application: Daniel Gleyzer (K7VM2MP885)"
KEYCHAIN_PROFILE="${NOTARY_PROFILE:-scene-search-notary}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENTITLEMENTS="packaging/entitlements.plist"
APP="dist/${APP_NAME}.app"
ARCH="$(uname -m)"
DIST_ZIP="dist/${APP_NAME// /-}-macOS-${ARCH}.zip"

echo "==> Cleaning previous build"
rm -rf build dist

echo "==> Building .app with PyInstaller"
.venv/bin/pyinstaller "packaging/${APP_NAME}.spec" --noconfirm

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
