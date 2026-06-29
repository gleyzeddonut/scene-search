#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
.venv/bin/python -m pip install pyinstaller >/dev/null 2>&1 || true
rm -rf build dist-engine
.venv/bin/pyinstaller "packaging/scripty-engine.spec" --noconfirm --distpath dist-engine --workpath build
echo "built dist-engine/scripty-engine/scripty-engine"
