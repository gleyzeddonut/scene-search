#!/usr/bin/env bash
# Build the PyInstaller engine binary. VENV selects the interpreter/arch:
#   default .venv (arm64); VENV=.venv-intel for x86_64 (built via Rosetta).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VENV="${VENV:-.venv}"
"$VENV/bin/python" -m pip install pyinstaller >/dev/null 2>&1 || true
rm -rf build dist-engine
"$VENV/bin/pyinstaller" "packaging/scripty-engine.spec" --noconfirm --distpath dist-engine --workpath build
ARCH="$(lipo -archs "dist-engine/scripty-engine/scripty-engine" | tr ' ' '-')"
echo "built dist-engine/scripty-engine/scripty-engine ($ARCH)"
