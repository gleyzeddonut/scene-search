#!/usr/bin/env bash
# Build the signed, notarized Scripty .dmgs (arm64 + x64). Pure JS — no engine binary.
#   ./packaging/build_app.sh                 # build only (app/dist/)
#   PUBLISH=always ./packaging/build_app.sh  # build + publish to GitHub releases
#                                            # (needs: export GH_TOKEN=$(gh auth token))
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && cd .. && pwd)"
cd "$ROOT/app"
PUBLISH="${PUBLISH:-never}"
npx electron-vite build && npx electron-builder --mac --arm64 --x64 --publish "$PUBLISH"
echo ""
echo "Done. Distributables in app/dist/:"
ls -1 dist/*.dmg 2>/dev/null || true
