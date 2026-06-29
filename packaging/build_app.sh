#!/usr/bin/env bash
# Build signed, notarized Scripty for BOTH architectures in one electron-builder
# pass, so a single correct latest-mac.yml is produced (required for auto-update
# to serve the right arch). Both engine binaries are bundled; the app picks the
# matching one at runtime.
#
#   ./packaging/build_app.sh                 # build only (dist/)
#   PUBLISH=always ./packaging/build_app.sh  # build + publish to GitHub releases
#                                            # (needs: export GH_TOKEN=$(gh auth token))
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && cd .. && pwd)"
cd "$ROOT"
PUBLISH="${PUBLISH:-never}"

echo "==> Engine binaries (both arches)"
VENV=.venv ./packaging/build_engine.sh        # -> dist-engine/arm64
VENV=.venv-intel ./packaging/build_engine.sh  # -> dist-engine/x64

echo "==> Renderer + packaged apps (arm64 + x64, signed + notarized)"
( cd app && npx electron-vite build && npx electron-builder --mac --arm64 --x64 --publish "$PUBLISH" )

echo ""
echo "Done. Distributables in app/dist/:"
ls -1 app/dist/*.dmg 2>/dev/null || true
