#!/usr/bin/env bash
# Build signed, notarized Scripty .dmgs for BOTH architectures.
# Each app bundles its matching-arch PyInstaller engine binary.
# Run from the repo root: ./packaging/build_app.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && cd .. && pwd)"
cd "$ROOT"

echo "==> Building the renderer (arch-independent)"
( cd app && npx electron-vite build )

echo "==> arm64: engine binary + signed app"
VENV=.venv ./packaging/build_engine.sh
( cd app && npx electron-builder --mac --arm64 )

echo "==> x86_64 (Intel): engine binary + signed app"
VENV=.venv-intel ./packaging/build_engine.sh
( cd app && npx electron-builder --mac --x64 )

echo ""
echo "Done. Distributables in app/dist/:"
ls -1 app/dist/*.dmg 2>/dev/null || true
