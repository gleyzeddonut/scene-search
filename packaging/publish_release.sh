#!/usr/bin/env bash
# Publish the current version's notarized zips as a GitHub release.
# Prereqs: both dist zips built (./packaging/build_release.sh and the Intel
# build) and `gh` authenticated.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="gleyzeddonut/scene-search"
VERSION="$(.venv/bin/python -c 'from scenesearch.version import __version__; print(__version__)')"
TAG="v${VERSION}"
ARM="dist/Scripty-macOS-arm64.zip"
INTEL="dist/Scripty-macOS-x86_64.zip"

for f in "$ARM" "$INTEL"; do
    [ -f "$f" ] || { echo "missing $f — build it first"; exit 1; }
done

echo "==> Publishing $TAG to $REPO"
gh release create "$TAG" "$ARM" "$INTEL" \
    --repo "$REPO" \
    --title "Scene Search ${VERSION}" \
    --notes "Automated release of Scene Search ${VERSION}."
echo "Done: https://github.com/${REPO}/releases/tag/${TAG}"
