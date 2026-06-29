# Electron Packaging & Signing — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a distributable, Developer-ID-signed, notarized **Scripty.app** (with the icon) — the Electron app bundling the Python engine as a PyInstaller binary, packaged by electron-builder.

**Architecture:** PyInstaller compiles the engine (`scenesearch.service`) into a standalone `scripty-engine` directory. electron-builder bundles it as an extraResource, builds the `.app`, deep-signs everything with the Developer ID, and notarizes via the stored notary profile. In production the Electron main spawns the bundled binary instead of the venv Python.

**Tech Stack:** PyInstaller, electron-builder, @electron/notarize, the existing Developer ID cert + `scene-search-notary` keychain profile.

## Global Constraints

- macOS, arm64 first (her Mac). Intel is a follow-up using the same flow.
- Bundle name **Scripty.app**, appId **com.gleyzer.scripty**, icon `app/build/icon.icns`.
- Engine binds 127.0.0.1 + token (unchanged). Offline: bundle fonts locally (no CDN).
- Signing identity: `Developer ID Application: Daniel Gleyzer (K7VM2MP885)`.
- Notarization via the existing keychain profile `scene-search-notary`.
- The actual `npm run dist` / `electron-vite`/`electron-builder` commands are **run by the user** (a machine guardrail blocks the agent from running local JS builds). The agent builds the engine binary (PyInstaller) and writes all config; the user runs the final packaging.

---

### Task 1: Bundle fonts in the renderer (offline)

**Files:**
- Create: `app/src/renderer/src/fonts/SpaceGrotesk.ttf`, `app/src/renderer/src/fonts/CourierPrime.ttf`
- Modify: `app/src/renderer/src/styles.css`, `app/src/renderer/index.html`

**Interfaces:**
- Produces: the UI renders with bundled fonts and no network font request.

- [ ] **Step 1: Copy the existing TTFs into the renderer**

```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
mkdir -p app/src/renderer/src/fonts
cp scenesearch/fonts/SpaceGrotesk.ttf app/src/renderer/src/fonts/
cp scenesearch/fonts/CourierPrime.ttf app/src/renderer/src/fonts/
```

- [ ] **Step 2: Add @font-face, remove the CDN link**

Prepend to `app/src/renderer/src/styles.css`:
```css
@font-face{font-family:'Space Grotesk';src:url('./fonts/SpaceGrotesk.ttf') format('truetype');font-weight:400 700;font-display:swap}
@font-face{font-family:'Courier Prime';src:url('./fonts/CourierPrime.ttf') format('truetype');font-weight:400;font-display:swap}
```
In `app/src/renderer/index.html`, delete the three Google Fonts `<link>` lines (preconnect + stylesheet).

- [ ] **Step 3: Typecheck (CSS-only change; just ensure the app still type-checks)**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/src/fonts app/src/renderer/src/styles.css app/src/renderer/index.html
git commit -m "feat: bundle fonts in the renderer for offline use"
```

---

### Task 2: PyInstaller engine binary

**Files:**
- Create: `packaging/engine_entry.py`
- Create: `packaging/scripty-engine.spec`
- Create: `packaging/build_engine.sh`

**Interfaces:**
- Produces: `dist-engine/scripty-engine/scripty-engine` — a standalone binary serving the API (no Python install needed).

- [ ] **Step 1: Entry script**

`packaging/engine_entry.py`:
```python
from scenesearch.service import main

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: PyInstaller spec**

`packaging/scripty-engine.spec`:
```python
# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import collect_all

PROJECT_ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [(os.path.join(PROJECT_ROOT, "scenesearch", "screenplay", "names_gender.json"),
          "scenesearch/screenplay")]
hiddenimports = []
for pkg in ("uvicorn", "fastapi", "anyio", "starlette", "pydantic"):
    d, b, h = collect_all(pkg)
    datas += d
    hiddenimports += h

a = Analysis(
    [os.path.join(PROJECT_ROOT, "packaging", "engine_entry.py")],
    pathex=[PROJECT_ROOT],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["PySide6", "tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="scripty-engine",
          console=True, disable_windowed_traceback=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="scripty-engine")
```

- [ ] **Step 3: Build script**

`packaging/build_engine.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
.venv/bin/python -m pip install pyinstaller >/dev/null 2>&1 || true
rm -rf build dist-engine
.venv/bin/pyinstaller "packaging/scripty-engine.spec" --noconfirm --distpath dist-engine --workpath build
echo "built dist-engine/scripty-engine/scripty-engine"
```
Then: `chmod +x packaging/build_engine.sh`.

- [ ] **Step 4: Build and smoke-test the binary**

Run:
```bash
./packaging/build_engine.sh 2>&1 | tail -3
./dist-engine/scripty-engine/scripty-engine --port 8799 --token tk &
SRV=$!; sleep 3
curl -s -H "X-Scripty-Token: tk" http://127.0.0.1:8799/health
kill $SRV
```
Expected: prints `{"status":"ok","version":...}` (the binary serves the API with no venv).

- [ ] **Step 5: Ignore engine build output + commit**

Append to `.gitignore`:
```
/dist-engine/
```
```bash
git add packaging/engine_entry.py packaging/scripty-engine.spec packaging/build_engine.sh .gitignore
git commit -m "build: PyInstaller engine binary (scripty-engine)"
```

---

### Task 3: Production engine spawn (bundled binary)

**Files:**
- Modify: `app/src/main/engine.ts`

**Interfaces:**
- Consumes: the bundled `scripty-engine` (Task 2) at `process.resourcesPath/engine/scripty-engine`.
- Produces: in a packaged app, main spawns the bundled binary; in dev it still runs the venv Python.

- [ ] **Step 1: Branch on app.isPackaged**

In `app/src/main/engine.ts`, replace the spawn block in `startEngine`:
```ts
  let cmd: string
  let args: string[]
  if (app.isPackaged) {
    cmd = join(process.resourcesPath, 'engine', 'scripty-engine')
    args = ['--port', String(port), '--token', token]
  } else {
    const repoRoot = join(app.getAppPath(), '..')
    cmd = join(repoRoot, '.venv', 'bin', 'python')
    args = ['-m', 'scenesearch.service', '--port', String(port), '--token', token]
  }
  const proc = spawn(cmd, args, {
    cwd: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  })
```
(Remove the old `repoRoot`/`python`/`spawn` lines this replaces.)

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/src/main/engine.ts
git commit -m "feat: spawn the bundled engine binary in packaged builds"
```

---

### Task 4: electron-builder config + notarize hook

**Files:**
- Modify: `app/package.json`
- Create: `app/electron-builder.yml`, `app/build/entitlements.mac.plist`, `app/scripts/notarize.cjs`

**Interfaces:**
- Produces: `npm run dist` config that bundles the engine, signs, and notarizes into `Scripty.app` + `.dmg`.

- [ ] **Step 1: Add electron-builder + scripts to package.json**

In `app/package.json`, add to `devDependencies`:
```json
    "electron-builder": "^24.13.3",
    "@electron/notarize": "^2.3.0"
```
and add to `scripts`:
```json
    "dist": "electron-vite build && electron-builder --mac --arm64"
```

- [ ] **Step 2: electron-builder.yml**

`app/electron-builder.yml`:
```yaml
appId: com.gleyzer.scripty
productName: Scripty
directories:
  buildResources: build
files:
  - out/**/*
  - package.json
extraResources:
  - from: ../dist-engine/scripty-engine
    to: engine
mac:
  category: public.app-category.productivity
  icon: build/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  identity: Developer ID Application: Daniel Gleyzer (K7VM2MP885)
  target:
    - dmg
    - zip
afterSign: scripts/notarize.cjs
```

- [ ] **Step 3: entitlements**

`app/build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.network.server</key><true/>
</dict>
</plist>
```

- [ ] **Step 4: notarize hook (uses the stored keychain profile)**

`app/scripts/notarize.cjs`:
```js
const { notarize } = require('@electron/notarize')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = `${context.appOutDir}/${appName}.app`
  console.log('Notarizing', appPath)
  await notarize({
    tool: 'notarytool',
    appPath,
    keychainProfile: 'scene-search-notary'
  })
}
```

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/electron-builder.yml app/build/entitlements.mac.plist app/scripts/notarize.cjs
git commit -m "build: electron-builder config + notarize hook (Developer ID)"
```

---

### Task 5: Build, sign, notarize (user-run) + verify

**Files:** none (build artifacts).

**Interfaces:** Produces a signed, notarized `Scripty.app` / `.dmg`.

- [ ] **Step 1: Build the engine binary (agent)**

Run: `./packaging/build_engine.sh 2>&1 | tail -2`
Expected: `dist-engine/scripty-engine/scripty-engine` exists.

- [ ] **Step 2: Install JS deps for builder (user, in their Terminal)**

The user runs:
```
cd "/Users/dangleyzer/Documents/CLAUDE/scene search/app" && npm install
```
Expected: electron-builder + @electron/notarize installed.

- [ ] **Step 3: Package + sign + notarize (user, in their Terminal)**

The user runs:
```
cd "/Users/dangleyzer/Documents/CLAUDE/scene search/app" && npm run dist
```
Expected: electron-vite builds, electron-builder produces `app/dist/Scripty-*.dmg` and `Scripty-*-mac.zip`, deep-signs with the Developer ID, and the afterSign hook notarizes (a few minutes). Watch your Keychain for a one-time prompt to use the signing key (click Always Allow).

- [ ] **Step 4: Verify (agent, once the user reports it built)**

Run:
```bash
APP="/Users/dangleyzer/Documents/CLAUDE/scene search/app/dist/mac-arm64/Scripty.app"
codesign --verify --strict --verbose=2 "$APP" 2>&1 | tail -2
spctl -a -vv "$APP" 2>&1 | head -3
/usr/libexec/PlistBuddy -c "Print CFBundleName" "$APP/Contents/Info.plist"
```
Expected: `accepted`, `source=Notarized Developer ID`, `Scripty`.

- [ ] **Step 5: Update README**

In `README.md`, add a "Package a release" section:
```markdown
## Package a signed release

```bash
./packaging/build_engine.sh                 # PyInstaller engine binary
cd app && npm install && npm run dist        # electron-builder: sign + notarize
# -> app/dist/Scripty-<ver>-arm64.dmg
```
```
```bash
git add README.md
git commit -m "docs: how to package a signed Scripty release"
```

---

## Self-Review

**Spec coverage (Phase 2):**
- PyInstaller engine binary → Task 2. ✓
- electron-builder bundles engine + builds .app → Task 4. ✓
- Developer-ID sign + notarize (keychain profile) → Tasks 4–5. ✓
- Production spawns bundled binary → Task 3. ✓
- Offline fonts → Task 1. ✓
- Icon (icon.icns already present) used by electron-builder → Task 4 (`mac.icon`). ✓
- Distributable .dmg/.zip → Task 5. ✓
- Auto-update (electron-updater) is Phase 3 (out of scope here). ✓

**Placeholder scan:** No TBDs; configs and the PyInstaller spec are complete. The packaging command is explicitly the user's to run (guardrail), with exact commands.

**Type consistency:** `scripty-engine` binary name consistent across the spec (Task 2), engine.ts prod path (Task 3 `process.resourcesPath/engine/scripty-engine`), and electron-builder `extraResources` (`to: engine`) (Task 4). `--port`/`--token` args consistent with `service.main()` (existing). appId `com.gleyzer.scripty` and productName `Scripty` consistent (Task 4). Keychain profile `scene-search-notary` consistent (Task 4 hook).
