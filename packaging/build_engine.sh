#!/usr/bin/env bash
# Build the PyInstaller engine binary. VENV selects the interpreter/arch:
#   default .venv (arm64); VENV=.venv-intel for x86_64 (built via Rosetta).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VENV="${VENV:-.venv}"
# electron-arch name (arm64 | x64) from the venv interpreter
PYARCH="$("$VENV/bin/python" -c 'import platform; print(platform.machine())')"
case "$PYARCH" in
  arm64) A=arm64 ;;
  x86_64) A=x64 ;;
  *) echo "unknown arch $PYARCH" >&2; exit 1 ;;
esac
"$VENV/bin/python" -m pip install pyinstaller >/dev/null 2>&1 || true
rm -rf "build/$A" "dist-engine/$A"
"$VENV/bin/pyinstaller" "packaging/scripty-engine.spec" --noconfirm \
  --distpath "dist-engine/$A" --workpath "build/$A"
echo "built dist-engine/$A/scripty-engine/scripty-engine ($PYARCH)"
