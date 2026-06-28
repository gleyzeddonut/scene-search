# Electron + React + Python Sidecar — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working **dev** app — Electron + React shell (Browse + Library, matching the Cue mockup) talking over local HTTP to the existing Python engine run as a sidecar.

**Architecture:** A FastAPI service wraps the engine (`scenesearch/service.py`). Electron's main process spawns it (127.0.0.1, random port, per-launch token), the React renderer calls it via `fetch`. Packaging/signing/auto-update are Phases 2–3.

**Tech Stack:** Python (FastAPI/uvicorn + existing engine), Node 24, Electron, electron-vite, React, TypeScript.

## Global Constraints

- macOS; offline app. Engine binds **127.0.0.1 only**, random port, requires the `X-Scripty-Token` header on every route.
- Reuse the existing engine modules unchanged (`scanner`, `library`, `finder`, `screenplay`, `gender`, `settings`, `version`, `fileops`).
- Phase 1 is **dev-mode only** (`npm run dev`); no packaging.
- Each FastAPI handler that touches SQLite opens its **own** `Library(index_path)` (sqlite connections are not shared across FastAPI's threadpool).
- Phase 1 indexes the **first** folder (matches today's behavior); multi-folder indexing is later.
- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`; only the preload API is exposed.

---

### Task 1: Engine service — core read endpoints

**Files:**
- Modify: `requirements.txt`
- Create: `scenesearch/service.py`
- Test: `tests/test_service.py`

**Interfaces:**
- Produces: `create_app(token: str, settings_path=None, index_path=None) -> FastAPI` with routes `/health`, `/folders` (GET/PUT), `/stats`, `/scenes`, all requiring header `X-Scripty-Token == token`.

- [ ] **Step 1: Add deps**

Append to `requirements.txt`:
```
fastapi>=0.110
uvicorn>=0.29
httpx>=0.27
```
Run: `.venv/bin/python -m pip install -r requirements.txt 2>&1 | tail -2`
Expected: installs fastapi, uvicorn, httpx (httpx is used by FastAPI's TestClient).

- [ ] **Step 2: Write the failing tests**

`tests/test_service.py`:
```python
from fastapi.testclient import TestClient

from scenesearch.service import create_app

TOKEN = "secret"
SCRIPT = "INT. OFFICE - DAY\n\nMICHAEL\nSit.\n\nJENNIFER\nNo.\n"


def _client(tmp_path):
    app = create_app(TOKEN, settings_path=tmp_path / "s.json", index_path=tmp_path / "i.db")
    return TestClient(app)


def _auth():
    return {"X-Scripty-Token": TOKEN}


def test_health_requires_token(tmp_path):
    c = _client(tmp_path)
    assert c.get("/health").status_code == 401
    r = c.get("/health", headers=_auth())
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_folders_get_and_put(tmp_path):
    c = _client(tmp_path)
    c.put("/folders", headers=_auth(), json={"roots": ["/a/b"], "ignored": ["/c"]})
    r = c.get("/folders", headers=_auth()).json()
    assert r["roots"] == ["/a/b"]
    assert r["ignored"] == ["/c"]


def test_stats_and_scenes_empty(tmp_path):
    c = _client(tmp_path)
    assert c.get("/stats", headers=_auth()).json() == {"scripts": 0, "scenes": 0}
    assert c.get("/scenes", headers=_auth()).json() == {"scenes": []}
```

- [ ] **Step 3: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.service'`.

- [ ] **Step 4: Implement the service core**

`scenesearch/service.py`:
```python
from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from . import fileops
from .finder import FilterSpec, scene_rows
from .library import Library
from .scanner import default_roots
from .screenplay.gender import guess_gender
from .settings import Settings
from .version import __version__


class Folders(BaseModel):
    roots: list[str]
    ignored: list[str] = []


class PathBody(BaseModel):
    path: str


def create_app(token: str, settings_path=None, index_path=None) -> FastAPI:
    app = FastAPI()
    settings = Settings(settings_path or Path.home() / ".scripty_settings.json")
    index_path = Path(index_path or Path.home() / ".scripty_index.db")
    state = {"running": False, "scanned": 0, "scripts": 0, "scenes": 0}

    def auth(x_scripty_token: str = Header(default="")):
        if x_scripty_token != token:
            raise HTTPException(status_code=401, detail="bad token")

    def lib() -> Library:
        return Library(index_path)

    @app.get("/health")
    def health(_=Depends(auth)):
        return {"status": "ok", "version": __version__}

    @app.get("/folders")
    def get_folders(_=Depends(auth)):
        roots = settings.get_roots()
        roots = roots if roots is not None else [str(r) for r in default_roots()]
        return {"roots": roots, "ignored": settings.get_ignored() or []}

    @app.put("/folders")
    def put_folders(body: Folders, _=Depends(auth)):
        settings.set_roots(body.roots)
        settings.set_ignored(body.ignored)
        return {"roots": body.roots, "ignored": body.ignored}

    @app.get("/stats")
    def stats(_=Depends(auth)):
        library = lib()
        try:
            return {"scripts": library.script_count(), "scenes": library.scene_count()}
        finally:
            library.close()

    @app.get("/scenes")
    def scenes(min_chars: int | None = None, max_chars: int | None = None,
               pairing: str | None = None, search: str = "", _=Depends(auth)):
        spec = FilterSpec(min_chars=min_chars, max_chars=max_chars, pairing=pairing or None)
        s = search.lower()
        library = lib()
        try:
            out = []
            for m in scene_rows(library, spec):
                if s and s not in m.script_name.lower() and s not in m.heading.lower():
                    continue
                out.append({
                    "script_path": m.script_path, "script_name": m.script_name,
                    "heading": m.heading, "page": m.page, "char_count": m.char_count,
                    "characters": [{"name": n, "gender": guess_gender(n)} for n in m.characters],
                    "pairing": m.pairing,
                })
            return {"scenes": out}
        finally:
            library.close()

    # ---- reindex + status + open/reveal are added in Task 2 ----
    app.state.settings = settings
    app.state.index_path = index_path
    app.state.reindex_state = state
    app.state.auth_dep = auth
    app.state.lib_factory = lib
    return app
```

- [ ] **Step 5: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_service.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add requirements.txt scenesearch/service.py tests/test_service.py
git commit -m "feat: engine FastAPI service core (health/folders/stats/scenes)"
```

---

### Task 2: Engine service — reindex, open, reveal

**Files:**
- Modify: `scenesearch/service.py`
- Test: `tests/test_service.py`

**Interfaces:**
- Consumes: Task 1 `create_app`.
- Produces: routes `POST /reindex`, `GET /reindex/status`, `POST /open`, `POST /reveal`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_service.py`:
```python
import time


def test_reindex_then_scenes(tmp_path):
    lib_dir = tmp_path / "lib"
    lib_dir.mkdir()
    (lib_dir / "x.fountain").write_text(SCRIPT)
    c = _client(tmp_path)
    c.put("/folders", headers=_auth(), json={"roots": [str(lib_dir)], "ignored": []})

    assert c.post("/reindex", headers=_auth()).json()["started"] is True
    for _ in range(100):
        st = c.get("/reindex/status", headers=_auth()).json()
        if not st["running"] and st["scenes"] > 0:
            break
        time.sleep(0.05)
    assert c.get("/stats", headers=_auth()).json()["scenes"] == 1

    scenes = c.get("/scenes", headers=_auth(), params={"min_chars": 2, "max_chars": 2}).json()["scenes"]
    assert len(scenes) == 1
    assert scenes[0]["heading"] == "INT. OFFICE - DAY"
    assert {ch["name"] for ch in scenes[0]["characters"]} == {"MICHAEL", "JENNIFER"}


def test_open_and_reveal(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr("scenesearch.service.fileops.open_external", lambda p: calls.append(("open", p)))
    monkeypatch.setattr("scenesearch.service.fileops.reveal_in_finder", lambda p: calls.append(("reveal", p)))
    c = _client(tmp_path)
    c.post("/open", headers=_auth(), json={"path": "/x/y.pdf"})
    c.post("/reveal", headers=_auth(), json={"path": "/x/y.pdf"})
    assert calls == [("open", "/x/y.pdf"), ("reveal", "/x/y.pdf")]
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_service.py -k "reindex or open" -v`
Expected: FAIL (404 — routes not defined yet).

- [ ] **Step 3: Implement**

In `scenesearch/service.py`, replace the `# ---- reindex ... ----` comment block (just before the `app.state...` lines) with:
```python
    import threading

    def _do_reindex(roots):
        state.update(running=True, scanned=0)
        try:
            if roots:
                worker = lib()
                try:
                    worker.reindex(roots[0])
                    state["scripts"] = worker.script_count()
                    state["scenes"] = worker.scene_count()
                finally:
                    worker.close()
        finally:
            state["running"] = False

    @app.post("/reindex")
    def reindex(_=Depends(auth)):
        roots = settings.get_roots() or [str(r) for r in default_roots()]
        if not state["running"]:
            threading.Thread(target=_do_reindex, args=(roots,), daemon=True).start()
        return {"started": True}

    @app.get("/reindex/status")
    def reindex_status(_=Depends(auth)):
        return {"running": state["running"], "scanned": state["scanned"],
                "scripts": state["scripts"], "scenes": state["scenes"]}

    @app.post("/open")
    def open_file(body: PathBody, _=Depends(auth)):
        fileops.open_external(body.path)
        return {"ok": True}

    @app.post("/reveal")
    def reveal(body: PathBody, _=Depends(auth)):
        fileops.reveal_in_finder(body.path)
        return {"ok": True}
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_service.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/service.py tests/test_service.py
git commit -m "feat: engine service reindex/status + open/reveal"
```

---

### Task 3: Engine CLI entry (`python -m scenesearch.service`)

**Files:**
- Modify: `scenesearch/service.py`

**Interfaces:**
- Produces: `scenesearch/service.py` runnable as `python -m scenesearch.service --port P --token T`, serving the app via uvicorn on `127.0.0.1:P`.

- [ ] **Step 1: Add the CLI entry**

Append to `scenesearch/service.py`:
```python
def main() -> None:
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    app = create_app(args.token)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test it (start, curl, stop)**

Run:
```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
.venv/bin/python -m scenesearch.service --port 8765 --token testtok &
SRV=$!
sleep 2
echo "no-token:"; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/health
echo "with-token:"; curl -s -H "X-Scripty-Token: testtok" http://127.0.0.1:8765/health
kill $SRV
```
Expected: `no-token: 401`, `with-token: {"status":"ok",...}`.

- [ ] **Step 3: Commit**

```bash
git add scenesearch/service.py
git commit -m "feat: engine service CLI entry (uvicorn on 127.0.0.1)"
```

---

### Task 4: Scaffold the Electron + React app

**Files:**
- Create: `app/package.json`, `app/electron.vite.config.ts`, `app/tsconfig.json`, `app/tsconfig.node.json`
- Create: `app/src/main/index.ts`, `app/src/preload/index.ts`
- Create: `app/src/renderer/index.html`, `app/src/renderer/src/main.tsx`, `app/src/renderer/src/App.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run dev` opens an Electron window rendering a placeholder React app.

- [ ] **Step 1: package.json**

`app/package.json`:
```json
{
  "name": "scripty",
  "version": "0.1.0",
  "description": "Scripty",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

- [ ] **Step 2: configs**

`app/electron.vite.config.ts`:
```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
```

`app/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["src"]
}
```

`app/tsconfig.node.json`:
```json
{ "extends": "./tsconfig.json" }
```

- [ ] **Step 3: main + preload (placeholder)**

`app/src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

`app/src/preload/index.ts`:
```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('scripty', {
  ping: () => 'pong'
})
```

- [ ] **Step 4: renderer placeholder**

`app/src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>Scripty</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`app/src/renderer/src/main.tsx`:
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`app/src/renderer/src/App.tsx`:
```tsx
export default function App() {
  return <div style={{ fontFamily: 'sans-serif', padding: 40 }}>Scripty — renderer up.</div>
}
```

- [ ] **Step 5: gitignore + install**

Append to `.gitignore`:
```
app/node_modules/
app/out/
app/dist/
```
Run:
```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search/app" && npm install 2>&1 | tail -3
```
Expected: installs without errors.

- [ ] **Step 6: Verify it builds**

Run: `cd "/Users/dangleyzer/Documents/CLAUDE/scene search/app" && npm run build 2>&1 | tail -5`
Expected: `electron-vite` builds main/preload/renderer with no errors (creates `out/`).

> Launching the actual window (`npm run dev`) is interactive; the maintainer runs it once to confirm a window appears. The build succeeding is the automated gate.

- [ ] **Step 7: Commit**

```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
git add app .gitignore
git commit -m "feat: scaffold Electron + React app (electron-vite)"
```

---

### Task 5: Spawn the engine sidecar from Electron main

**Files:**
- Modify: `app/src/main/index.ts`, `app/src/preload/index.ts`
- Create: `app/src/main/engine.ts`

**Interfaces:**
- Consumes: `python -m scenesearch.service` (Task 3).
- Produces: on launch, main starts the engine on a free port with a random token, waits for `/health`, and exposes `{ port, token }` to the renderer via `window.scripty.engine`.

- [ ] **Step 1: engine manager**

`app/src/main/engine.ts`:
```ts
import { spawn, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { createServer } from 'net'
import { join } from 'path'
import { app } from 'electron'

export interface EngineHandle {
  port: number
  token: string
  proc: ChildProcess
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as any).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function waitForHealth(port: number, token: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { 'X-Scripty-Token': token }
      })
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 100))
  }
  throw new Error('engine did not start')
}

export async function startEngine(): Promise<EngineHandle> {
  const port = await freePort()
  const token = randomBytes(16).toString('hex')
  // dev: run the repo venv python; prod (Phase 2) will use the bundled binary
  const repoRoot = join(app.getAppPath(), '..')
  const python = join(repoRoot, '.venv', 'bin', 'python')
  const proc = spawn(python, ['-m', 'scenesearch.service', '--port', String(port), '--token', token], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  proc.stderr?.on('data', (d) => console.error('[engine]', d.toString()))
  await waitForHealth(port, token)
  return { port, token, proc }
}
```

- [ ] **Step 2: wire into main + preload**

Replace `app/src/main/index.ts`:
```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { startEngine, EngineHandle } from './engine'

let engine: EngineHandle | null = null

async function createWindow() {
  engine = await startEngine()
  ipcMain.handle('engine-info', () => ({ port: engine!.port, token: engine!.token }))

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => engine?.proc.kill())
```

`app/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('scripty', {
  engineInfo: () => ipcRenderer.invoke('engine-info')
})
```

- [ ] **Step 3: Verify the renderer reaches the engine**

Replace `app/src/renderer/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'

declare global {
  interface Window {
    scripty: { engineInfo: () => Promise<{ port: number; token: string }> }
  }
}

export default function App() {
  const [status, setStatus] = useState('connecting…')
  useEffect(() => {
    window.scripty.engineInfo().then(async ({ port, token }) => {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { 'X-Scripty-Token': token } })
      const j = await r.json()
      setStatus(`engine ok — v${j.version}`)
    }).catch((e) => setStatus('engine error: ' + e))
  }, [])
  return <div style={{ fontFamily: 'sans-serif', padding: 40 }}>Scripty — {status}</div>
}
```

Run: `cd app && npm run build 2>&1 | tail -3`
Expected: builds clean.

> Maintainer runs `npm run dev` once and confirms the window shows "engine ok — v1.4.1" (proves the sidecar spawned + the token-authed fetch works end-to-end).

- [ ] **Step 4: Commit**

```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
git add app
git commit -m "feat: spawn engine sidecar from Electron main; renderer reaches it"
```

---

### Task 6: Renderer API client + folder picker IPC

**Files:**
- Create: `app/src/renderer/src/api.ts`
- Modify: `app/src/main/index.ts`, `app/src/preload/index.ts`

**Interfaces:**
- Produces: `api.ts` with `init()`, `getFolders()`, `setFolders(roots, ignored)`, `reindex()`, `reindexStatus()`, `stats()`, `scenes(params)`, `openFile(path)`, `revealFile(path)`, `pickFolder()`.

- [ ] **Step 1: Add the folder-picker IPC in main**

In `app/src/main/index.ts`, add after the `engine-info` handler:
```ts
  ipcMain.handle('pick-folder', async () => {
    const { dialog } = await import('electron')
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
```

In `app/src/preload/index.ts`, extend the exposed API:
```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('scripty', {
  engineInfo: () => ipcRenderer.invoke('engine-info'),
  pickFolder: () => ipcRenderer.invoke('pick-folder') as Promise<string | null>
})
```

- [ ] **Step 2: API client**

`app/src/renderer/src/api.ts`:
```ts
export interface SceneChar { name: string; gender: string }
export interface Scene {
  script_path: string; script_name: string; heading: string; page: number
  char_count: number; characters: SceneChar[]; pairing: string | null
}

let base = ''
let token = ''

export async function init() {
  const info = await (window as any).scripty.engineInfo()
  base = `http://127.0.0.1:${info.port}`
  token = info.token
}

async function call(path: string, opts: RequestInit = {}) {
  const r = await fetch(base + path, {
    ...opts,
    headers: { 'X-Scripty-Token': token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

export const api = {
  getFolders: () => call('/folders'),
  setFolders: (roots: string[], ignored: string[]) =>
    call('/folders', { method: 'PUT', body: JSON.stringify({ roots, ignored }) }),
  reindex: () => call('/reindex', { method: 'POST' }),
  reindexStatus: () => call('/reindex/status'),
  stats: () => call('/stats'),
  scenes: (p: { min_chars?: number; max_chars?: number; pairing?: string; search?: string }) => {
    const q = new URLSearchParams()
    if (p.min_chars != null) q.set('min_chars', String(p.min_chars))
    if (p.max_chars != null) q.set('max_chars', String(p.max_chars))
    if (p.pairing) q.set('pairing', p.pairing)
    if (p.search) q.set('search', p.search)
    return call('/scenes?' + q.toString()) as Promise<{ scenes: Scene[] }>
  },
  openFile: (path: string) => call('/open', { method: 'POST', body: JSON.stringify({ path }) }),
  revealFile: (path: string) => call('/reveal', { method: 'POST', body: JSON.stringify({ path }) }),
  pickFolder: () => (window as any).scripty.pickFolder() as Promise<string | null>
}
```

- [ ] **Step 3: Verify build + typecheck**

Run: `cd app && npm run build 2>&1 | tail -3 && npm run typecheck 2>&1 | tail -3`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
git add app
git commit -m "feat: renderer API client + folder-picker IPC"
```

---

### Task 7: React UI — shell + Library + Browse (wired to the engine)

**Files:**
- Create: `app/src/renderer/src/styles.css`, `app/src/renderer/src/AppShell.tsx`, `app/src/renderer/src/LibraryView.tsx`, `app/src/renderer/src/BrowseView.tsx`
- Modify: `app/src/renderer/src/App.tsx`, `app/src/renderer/index.html`

**Interfaces:**
- Consumes: `api` (Task 6).
- Produces: the running UI — nav rail (Browse/Library), Library (folders + reindex + stats), Browse (filters + scene list with gender chips + detail).

- [ ] **Step 1: base CSS (palette + fonts from the mockup)**

`app/src/renderer/src/styles.css`:
```css
@font-face { font-family: 'Space Grotesk'; src: local('Space Grotesk'); }
:root{
  --app-bg:oklch(0.96 0.004 270); --chrome:oklch(0.975 0.003 270); --rail:oklch(0.985 0.002 270);
  --nav:oklch(0.97 0.003 270); --panel:oklch(0.978 0.003 270); --window:oklch(0.997 0.001 270);
  --border:oklch(0.92 0.006 270); --border-soft:oklch(0.95 0.005 270);
  --text:oklch(0.24 0.012 270); --text-2:oklch(0.46 0.012 270); --text-3:oklch(0.6 0.012 270);
  --accent:oklch(0.55 0.16 270); --accent-soft:oklch(0.95 0.03 270); --accent-text:oklch(0.5 0.11 270);
  --chip:oklch(0.95 0.004 270); --sel:oklch(0.965 0.02 270); --field:oklch(0.96 0.004 270);
  --w-bg:oklch(0.82 0.08 25); --w-fg:oklch(0.36 0.09 25);
  --m-bg:oklch(0.8 0.07 235); --m-fg:oklch(0.36 0.09 235);
}
[data-theme="dark"]{
  --app-bg:oklch(0.13 0.012 270); --chrome:oklch(0.155 0.012 270); --rail:oklch(0.165 0.012 270);
  --nav:oklch(0.145 0.012 270); --panel:oklch(0.165 0.012 270); --window:oklch(0.185 0.012 270);
  --border:oklch(0.27 0.012 270); --border-soft:oklch(0.235 0.012 270);
  --text:oklch(0.93 0.008 270); --text-2:oklch(0.72 0.01 270); --text-3:oklch(0.58 0.012 270);
  --accent:oklch(0.64 0.15 270); --accent-soft:oklch(0.32 0.07 270); --accent-text:oklch(0.82 0.1 270);
  --chip:oklch(0.23 0.012 270); --sel:oklch(0.27 0.045 270); --field:oklch(0.2 0.012 270);
  --w-bg:oklch(0.52 0.1 25); --w-fg:oklch(0.92 0.05 25);
  --m-bg:oklch(0.5 0.09 235); --m-fg:oklch(0.92 0.05 235);
}
*{box-sizing:border-box}
body{margin:0;font-family:'Space Grotesk',-apple-system,sans-serif;color:var(--text);background:var(--app-bg)}
.app{display:flex;flex-direction:column;height:100vh}
.toolbar{height:50px;display:flex;align-items:center;gap:9px;padding:0 16px;background:var(--chrome);border-bottom:1px solid var(--border)}
.brand-dot{width:17px;height:17px;border-radius:5px;background:var(--accent)}
.wordmark{font-weight:700;font-size:15px}
.search{flex:0 0 400px;margin:0 auto;display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--field);border:1px solid var(--border);border-radius:9px}
.search input{flex:1;border:none;outline:none;background:transparent;color:var(--text);font:inherit}
.kbd{font-size:11px;font-weight:600;color:var(--text-3);border:1px solid var(--border);border-radius:5px;padding:2px 5px}
.seg{display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}
.seg button{border:none;background:transparent;padding:5px 9px;color:var(--text-3);cursor:pointer}
.seg button.on{background:var(--accent);color:#fff}
.body{flex:1;display:flex;min-height:0}
.nav{width:76px;background:var(--nav);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:14px 0;gap:6px}
.nav button{width:56px;height:50px;border:none;background:transparent;border-radius:12px;color:var(--text-3);font-size:9px;font-weight:700;cursor:pointer}
.nav button.on{background:var(--accent-soft);color:var(--accent-text)}
.rail{width:252px;background:var(--rail);border-right:1px solid var(--border);padding:18px;overflow:auto}
.section-label{font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-3);text-transform:uppercase;margin:8px 0}
.chips{display:flex;flex-wrap:wrap;gap:5px}
.chip{border:1px solid transparent;background:var(--chip);color:var(--text-2);border-radius:999px;padding:6px 13px;font-size:12px;font-weight:600;cursor:pointer}
.chip.on{background:var(--accent-soft);color:var(--accent-text)}
.list-pane{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--window);border-right:1px solid var(--border)}
.list-head{height:46px;display:flex;align-items:center;padding:0 20px;color:var(--text-3);font-size:12px;border-bottom:1px solid var(--border)}
.list{flex:1;overflow:auto}
.row{display:flex;align-items:center;gap:10px;padding:9px 16px;margin:1px 8px;border-radius:9px;cursor:pointer}
.row:hover{background:var(--border-soft)}
.row.on{background:var(--sel)}
.row .title{font-size:14px;font-weight:600}
.row .sub{font-family:'Courier Prime',monospace;font-size:11px;color:var(--text-3)}
.gchip{width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
.gchip.W{background:var(--w-bg);color:var(--w-fg)} .gchip.M{background:var(--m-bg);color:var(--m-fg)}
.gchip.U{background:var(--chip);color:var(--text-3)}
.panel{width:372px;background:var(--panel);border-left:1px solid var(--border);padding:22px;display:flex;flex-direction:column;gap:8px}
.detail-heading{font-family:'Courier Prime',monospace;font-size:12px;color:var(--text-3)}
.detail-title{font-size:22px;font-weight:700}
.tag{background:var(--chip);color:var(--text-2);border-radius:999px;padding:5px 11px;font-size:11px;font-weight:600}
.card{flex:1;background:var(--window);border:1px solid var(--border);border-radius:11px;padding:22px;overflow:auto}
.btn{background:var(--chip);border:1px solid var(--border);border-radius:9px;padding:9px 14px;color:var(--text-2);font-weight:600;cursor:pointer}
.btn.primary{background:var(--accent);color:#fff;border:none;font-weight:700}
.libwrap{flex:1;overflow:auto;padding:30px;background:var(--rail)}
.stats{display:flex;gap:12px;margin:18px 0}
.stat{flex:1;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px}
.stat .n{font-size:26px;font-weight:700} .stat .l{font-size:12px;color:var(--text-3);margin-top:6px}
.folder{display:flex;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border-soft)}
.folder .path{font-family:'Courier Prime',monospace;font-size:11px;color:var(--text-3)}
.folders{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--window)}
```

In `app/src/renderer/index.html`, add the fonts link inside `<head>`:
```html
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: AppShell**

`app/src/renderer/src/AppShell.tsx`:
```tsx
import { ReactNode } from 'react'

export function AppShell(props: {
  section: string
  onSection: (s: string) => void
  search: string
  onSearch: (s: string) => void
  theme: string
  onTheme: (t: string) => void
  children: ReactNode
}) {
  const nav = [['browse', 'Browse'], ['prepare', 'Prepare'], ['library', 'Library']]
  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand-dot" />
        <div className="wordmark">Scripty</div>
        <div className="search">
          <input placeholder="Search scenes, characters…" value={props.search}
                 onChange={(e) => props.onSearch(e.target.value)} />
          <span className="kbd">⌘K</span>
        </div>
        <div className="seg">
          <button className={props.theme === 'light' ? 'on' : ''} onClick={() => props.onTheme('light')}>☀</button>
          <button className={props.theme === 'dark' ? 'on' : ''} onClick={() => props.onTheme('dark')}>☾</button>
        </div>
      </div>
      <div className="body">
        <div className="nav">
          {nav.map(([key, label]) => (
            <button key={key} className={props.section === key ? 'on' : ''} onClick={() => props.onSection(key)}>{label}</button>
          ))}
        </div>
        {props.children}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: LibraryView**

`app/src/renderer/src/LibraryView.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { api } from './api'

export function LibraryView() {
  const [roots, setRoots] = useState<string[]>([])
  const [stats, setStats] = useState({ scripts: 0, scenes: 0 })
  const [status, setStatus] = useState('')

  const load = async () => {
    setRoots((await api.getFolders()).roots)
    setStats(await api.stats())
  }
  useEffect(() => { load() }, [])

  const add = async () => {
    const f = await api.pickFolder()
    if (f) { const next = [...roots, f]; setRoots(next); await api.setFolders(next, []) }
  }
  const remove = async (p: string) => {
    const next = roots.filter((r) => r !== p); setRoots(next); await api.setFolders(next, [])
  }
  const reindex = async () => {
    setStatus('Indexing…'); await api.reindex()
    const poll = setInterval(async () => {
      const st = await api.reindexStatus()
      setStatus(`Indexing… ${st.scenes} scenes`)
      if (!st.running) { clearInterval(poll); setStatus(`Indexed: ${st.scripts} scripts, ${st.scenes} scenes`); setStats(st) }
    }, 300)
  }

  return (
    <div className="libwrap">
      <div style={{ fontSize: 22, fontWeight: 700 }}>Library</div>
      <div style={{ color: 'var(--text-3)' }}>Scripty indexes the script files on your drive — nothing leaves your Mac.</div>
      <div className="stats">
        <div className="stat"><div className="n">{stats.scripts}</div><div className="l">scripts indexed</div></div>
        <div className="stat"><div className="n">{stats.scenes}</div><div className="l">scenes parsed</div></div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0' }}>
        <div className="section-label">Indexed folders</div>
        <button className="btn" onClick={add}>＋ Add folder…</button>
      </div>
      <div className="folders">
        {roots.map((r) => (
          <div className="folder" key={r}>
            <div style={{ flex: 1 }}><div className="path">{r}</div></div>
            <button className="btn" onClick={() => remove(r)}>Remove</button>
          </div>
        ))}
      </div>
      <div style={{ margin: '16px 0' }}>{status}</div>
      <button className="btn primary" onClick={reindex}>Re-index now</button>
    </div>
  )
}
```

- [ ] **Step 4: BrowseView**

`app/src/renderer/src/BrowseView.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { api, Scene } from './api'

const SIZE = [['Any', [0, 50]], ['1', [1, 1]], ['2', [2, 2]], ['3', [3, 3]], ['4+', [4, 50]]] as const
const PAIR = [['Any', null], ['M+W', 'MW'], ['M+M', 'MM'], ['W+W', 'WW'], ['?', 'has_unknown']] as const

function gletter(g: string) { return g === 'female' ? 'W' : g === 'male' ? 'M' : 'U' }

export function BrowseView({ search }: { search: string }) {
  const [size, setSize] = useState(2)
  const [pair, setPair] = useState(0)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [sel, setSel] = useState<Scene | null>(null)

  useEffect(() => {
    const [mn, mx] = SIZE[size][1]
    api.scenes({ min_chars: mn, max_chars: mx, pairing: PAIR[pair][1] || undefined, search })
      .then((r) => { setScenes(r.scenes); setSel(r.scenes[0] || null) })
  }, [size, pair, search])

  return (
    <>
      <div className="rail">
        <div className="section-label">Scene size</div>
        <div className="chips">{SIZE.map(([l], i) => <button key={l} className={'chip' + (i === size ? ' on' : '')} onClick={() => setSize(i)}>{l}</button>)}</div>
        <div className="section-label">Partner pairing</div>
        <div className="chips">{PAIR.map(([l], i) => <button key={l} className={'chip' + (i === pair ? ' on' : '')} onClick={() => setPair(i)}>{l}</button>)}</div>
      </div>
      <div className="list-pane">
        <div className="list-head">{scenes.length} scene{scenes.length !== 1 ? 's' : ''}</div>
        <div className="list">
          {scenes.map((s) => (
            <div key={s.script_path + s.heading} className={'row' + (sel === s ? ' on' : '')} onClick={() => setSel(s)} onDoubleClick={() => api.openFile(s.script_path)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="title">{s.script_name.replace(/\.[^.]+$/, '')}</div>
                <div className="sub">{s.heading}{s.page ? ` · p.${s.page}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {s.characters.slice(0, 3).map((c) => <div key={c.name} className={'gchip ' + gletter(c.gender)} title={c.name}>{gletter(c.gender)}</div>)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        {sel && <>
          <div className="detail-heading">{sel.heading}</div>
          <div className="detail-title">{sel.script_name.replace(/\.[^.]+$/, '')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span className="tag">{sel.char_count === 2 ? 'Two-hander' : `${sel.char_count} cast`}</span>
            {sel.pairing && <span className="tag">{sel.pairing}</span>}
          </div>
          <div className="card">
            <div className="detail-heading">{sel.heading}</div>
            {sel.characters.map((c) => <div key={c.name} style={{ textAlign: 'center', fontFamily: 'Courier Prime, monospace', marginTop: 10 }}>{c.name}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn primary" style={{ flex: 1 }}>Prepare scene →</button>
            <button className="btn" onClick={() => api.openFile(sel.script_path)}>Open file</button>
            <button className="btn" onClick={() => api.revealFile(sel.script_path)}>Reveal</button>
          </div>
        </>}
      </div>
    </>
  )
}
```

- [ ] **Step 5: App wiring**

Replace `app/src/renderer/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import './styles.css'
import { init } from './api'
import { AppShell } from './AppShell'
import { BrowseView } from './BrowseView'
import { LibraryView } from './LibraryView'

export default function App() {
  const [ready, setReady] = useState(false)
  const [section, setSection] = useState('library')
  const [search, setSearch] = useState('')
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light')

  useEffect(() => { init().then(() => setReady(true)) }, [])
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme) }, [theme])

  if (!ready) return <div style={{ padding: 40 }}>Starting engine…</div>
  return (
    <AppShell section={section} onSection={setSection} search={search} onSearch={setSearch} theme={theme} onTheme={setTheme}>
      {section === 'browse' && <BrowseView search={search} />}
      {section === 'library' && <LibraryView />}
      {section === 'prepare' && <div style={{ padding: 40, color: 'var(--text-3)' }}>Prepare — coming soon.</div>}
    </AppShell>
  )
}
```

- [ ] **Step 6: Verify build + typecheck**

Run: `cd app && npm run build 2>&1 | tail -3 && npm run typecheck 2>&1 | tail -3`
Expected: both succeed.

> Maintainer runs `npm run dev`, goes to Library → Add folder → Re-index, then Browse to confirm scenes + gender chips render and filtering works.

- [ ] **Step 7: Commit**

```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
git add app
git commit -m "feat: React UI — shell + Library + Browse wired to the engine"
```

---

### Task 8: Retire the PySide6 UI + docs

**Files:**
- Delete: `scenesearch/ui/`, `scenesearch/theme.py`, `scenesearch/updater.py`, `app.py`, `packaging/Scripty.spec`, `packaging/build_release.sh`, `packaging/publish_release.sh`, and their tests (`tests/test_theme.py`, `tests/test_updater.py`, `tests/test_updater_io.py`)
- Modify: `README.md`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a repo whose only UI is the Electron app; engine + service tests remain green.

- [ ] **Step 1: Delete the PySide6 surface**

```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
git rm -r scenesearch/ui scenesearch/theme.py scenesearch/updater.py app.py \
  packaging/Scripty.spec packaging/build_release.sh packaging/publish_release.sh \
  packaging/build_fonts.py tests/test_theme.py tests/test_updater.py tests/test_updater_io.py
```

- [ ] **Step 2: Remove PySide6 from requirements**

In `requirements.txt`, delete the `PySide6>=6.7` line (the engine sidecar doesn't use Qt). Keep pypdf, python-docx, Send2Trash, fastapi, uvicorn, httpx, pytest.

- [ ] **Step 3: Run the Python suite (engine + service only)**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS (the parser/gender/library/finder/scanner/settings/service/version tests; UI/theme/updater tests are gone).

- [ ] **Step 4: Update CI + README**

In `.github/workflows/ci.yml`, the install line already installs only core deps; add `fastapi uvicorn httpx` to it:
```yaml
          pip install pypdf python-docx Send2Trash fastapi uvicorn httpx pytest
```

Replace the top of `README.md` with:
```markdown
# Scripty

A native macOS app that finds, browses, and prepares movie scripts on your Mac —
fully offline. The UI is Electron + React; the screenplay engine is Python, run
as a local sidecar.

## Develop

```bash
# engine deps
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
# app
cd app && npm install
npm run dev        # launches Electron + the engine sidecar
```

Run the engine tests with `.venv/bin/python -m pytest`.
```

- [ ] **Step 5: Run suite once more and commit**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS.

```bash
git add -A
git commit -m "chore: retire PySide6 UI; Electron app is the only UI now"
```

---

## Self-Review

**Spec coverage (Phase 1):**
- FastAPI engine service (health/folders/stats/scenes/reindex/open/reveal) + token → Tasks 1–2. ✓
- CLI entry (uvicorn, 127.0.0.1) → Task 3. ✓
- Electron scaffold (electron-vite, React, TS) → Task 4. ✓
- Spawn sidecar (free port, token, health-poll, kill on quit) → Task 5. ✓
- Renderer API client + folder-picker IPC → Task 6. ✓
- React UI (shell + Library + Browse with gender chips, themed) → Task 7. ✓
- Retire PySide6; keep engine tests; CI/README → Task 8. ✓
- Packaging/signing/auto-update + Prepare are Phases 2–3 (out of this plan). ✓

**Placeholder scan:** Engine tasks are full TDD; Electron/React tasks give complete runnable files. The CSS is the mockup palette base; visual polish is iterated against the running app (expected per the spec's "verified by running"). No TBDs.

**Type consistency:** `create_app(token, settings_path, index_path)` consistent Tasks 1→3. Engine routes/paths consistent with `api.ts` calls (Task 6) and the UI (Task 7): `/folders`,`/stats`,`/scenes`,`/reindex`,`/reindex/status`,`/open`,`/reveal`. `Scene`/`SceneChar` shape in `api.ts` matches the `/scenes` JSON from Task 1. `window.scripty.engineInfo/pickFolder` consistent between preload (Tasks 5–6) and `api.ts`. `EngineHandle{port,token,proc}` consistent in `engine.ts`/`main` (Task 5).
