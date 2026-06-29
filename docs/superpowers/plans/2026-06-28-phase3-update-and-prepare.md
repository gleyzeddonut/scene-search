# Phase 3 — Auto-Update + Prepare/Sides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (A) in-app auto-update via electron-updater + GitHub releases, and (B) the Prepare/Sides feature (engine dialogue extraction + a React sides view with role selection, rehearse mode, and PDF export).

**Architecture:** Part A wires `electron-updater` in the Electron main process (launch check + manual menu) against the existing GitHub repo, with electron-builder publishing the signed artifacts. Part B extends the Python parser to capture dialogue lines, exposes them via a new engine endpoint, and adds a React Prepare view; PDF export uses Electron's `printToPDF`.

**Tech Stack:** electron-updater, electron-builder (github publish), existing Python engine, React, Electron `BrowserWindow.printToPDF`.

## Global Constraints

- macOS; offline app (engine 127.0.0.1 + token unchanged). Auto-update is the one network feature (talks to GitHub releases only).
- Updates come from `gleyzeddonut/scene-search` GitHub releases; signed + notarized (required for electron-updater to install on macOS).
- Engine modules stay GUI-free + unit-tested. Electron/React `dist`/`dev`/publish commands are **run by the user** (machine guardrail); the agent writes config + code and TDDs the engine.
- App version lives in `app/package.json` (`version`); bump it per release so updates trigger.

---

## Part A — Auto-update (electron-updater)

### Task A1: Dependencies + publish config

**Files:**
- Modify: `app/package.json`, `app/electron-builder.yml`

**Interfaces:**
- Produces: `electron-updater` available; electron-builder configured to publish to GitHub.

- [ ] **Step 1: Add the dependency**

In `app/package.json`, add to `dependencies`:
```json
    "electron-updater": "^6.3.9"
```

- [ ] **Step 2: Publish config**

In `app/electron-builder.yml`, add at the top level (sibling of `mac:`):
```yaml
publish:
  provider: github
  owner: gleyzeddonut
  repo: scene-search
```

- [ ] **Step 3: Commit**

```bash
git add app/package.json app/electron-builder.yml
git commit -m "build: electron-updater dep + GitHub publish config"
```

---

### Task A2: Updater in the main process

**Files:**
- Create: `app/src/main/updater.ts`
- Modify: `app/src/main/index.ts`

**Interfaces:**
- Consumes: `electron-updater`'s `autoUpdater`.
- Produces: `setupUpdater(getWindow)` (launch check, event→dialog wiring) and `checkForUpdatesManual()` (menu action).

- [ ] **Step 1: Updater module**

`app/src/main/updater.ts`:
```ts
import { autoUpdater } from 'electron-updater'
import { dialog, BrowserWindow } from 'electron'

let manual = false

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    if (manual) {
      const w = getWindow()
      if (w) dialog.showMessageBox(w, { type: 'info', message: 'Update available', detail: 'Downloading in the background…' })
    }
  })
  autoUpdater.on('update-not-available', () => {
    if (manual) {
      const w = getWindow()
      if (w) dialog.showMessageBox(w, { type: 'info', message: 'Scripty is up to date.' })
    }
    manual = false
  })
  autoUpdater.on('update-downloaded', async () => {
    const w = getWindow()
    if (!w) return
    const r = await dialog.showMessageBox(w, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      message: 'Update ready',
      detail: 'Restart Scripty to finish updating.'
    })
    if (r.response === 0) autoUpdater.quitAndInstall()
    manual = false
  })
  autoUpdater.on('error', () => {
    manual = false // stay silent on background errors
  })

  autoUpdater.checkForUpdates().catch(() => {})
}

export function checkForUpdatesManual(): void {
  manual = true
  autoUpdater.checkForUpdates().catch(() => {})
}
```

- [ ] **Step 2: Wire into main + the Help menu**

In `app/src/main/index.ts`:
- add `import { setupUpdater, checkForUpdatesManual } from './updater'`
- replace the `Check for Updates…` menu item's `click` with:
```ts
        { label: 'Check for Updates…', click: () => checkForUpdatesManual() },
```
- at the end of `createWindow()` (after the window loads), add:
```ts
  if (app.isPackaged) setupUpdater(() => mainWindow)
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/updater.ts app/src/main/index.ts
git commit -m "feat: electron-updater (launch + manual check, install on relaunch)"
```

---

### Task A3: Publish flow + end-to-end (user-run)

**Files:**
- Modify: `packaging/build_app.sh`, `README.md`

**Interfaces:**
- Produces: a `--publish` path that uploads signed artifacts + `latest-mac.yml` to a GitHub release.

- [ ] **Step 1: Publish-capable build**

In `packaging/build_app.sh`, change the two `electron-builder` lines to honor a publish flag:
```bash
PUBLISH="${PUBLISH:-never}"
...
( cd app && npx electron-builder --mac --arm64 --publish "$PUBLISH" )
...
( cd app && npx electron-builder --mac --x64 --publish "$PUBLISH" )
```

- [ ] **Step 2: Document the release flow (README)**

Append to the "Package a signed release" section in `README.md`:
```markdown
### Publishing an auto-updatable release

```bash
# bump app/package.json "version" first (e.g. 0.1.0 -> 0.2.0)
export GH_TOKEN="$(gh auth token)"
PUBLISH=always ./packaging/build_app.sh
```
This uploads the signed `.dmg`/`.zip` + `latest-mac.yml` to a GitHub release.
Installed apps (in Applications) pick it up on next launch via electron-updater.
```

- [ ] **Step 3: Commit**

```bash
git add packaging/build_app.sh README.md
git commit -m "build: publish auto-updatable releases to GitHub"
```

- [ ] **Step 4: End-to-end (user-run, after a build exists)**

The user, in their Terminal:
1. Bump `app/package.json` version, `export GH_TOKEN=$(gh auth token)`, `PUBLISH=always ./packaging/build_app.sh`.
2. Install the prior version in `~/Applications`, launch it, confirm the "Update ready → Restart now" prompt appears and updates the app.
(Agent verifies the published release assets include `latest-mac.yml` via `gh release view`.)

---

## Part B — Prepare/Sides

### Task B1: Parser captures dialogue lines

**Files:**
- Modify: `scenesearch/screenplay/parser.py`
- Test: `tests/test_parser.py`

**Interfaces:**
- Produces: `Scene.lines: list[tuple[str, str]]` (speaker, text) added to the existing `Scene`; `parse_scenes` populates it.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_parser.py`:
```python
def test_captures_dialogue_lines():
    text = "INT. ROOM - DAY\n\nJOHN\nHello there.\n\nMARY\nGo away,\nplease.\n"
    scene = parse_scenes(text)[0]
    assert scene.lines == [("JOHN", "Hello there."), ("MARY", "Go away, please.")]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_parser.py::test_captures_dialogue_lines -v`
Expected: FAIL (`Scene` has no `lines`, or it's empty).

- [ ] **Step 3: Implement**

In `scenesearch/screenplay/parser.py`, add `lines` to the dataclass:
```python
@dataclass
class Scene:
    heading: str
    index: int
    page: int
    characters: list[str] = field(default_factory=list)
    lines: list[tuple[str, str]] = field(default_factory=list)
```
In `parse_scenes`, when a cue is detected (inside the `if _is_cue(raw):` block, after appending the character), collect the dialogue block:
```python
            name = _normalize_character(raw)
            if name not in seen:
                seen.add(name)
                current.characters.append(name)
            # capture the dialogue block (until blank line / next cue / heading)
            said: list[str] = []
            j = i + 1
            while j < len(lines):
                nxt = lines[j]
                if not nxt.strip():
                    break
                if _SCENE_RE.match(nxt) or _is_cue(nxt):
                    break
                said.append(nxt.strip())
                j += 1
            if said:
                current.lines.append((name, " ".join(said)))
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_parser.py -v`
Expected: PASS (existing parser tests still pass — `lines` is additive).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/screenplay/parser.py tests/test_parser.py
git commit -m "feat: parser captures per-scene dialogue lines"
```

---

### Task B2: Runtime estimate + store dialogue + /scene endpoint

**Files:**
- Create: `scenesearch/screenplay/runtime.py`
- Modify: `scenesearch/library.py`, `scenesearch/service.py`
- Test: `tests/test_runtime.py`, `tests/test_library.py`, `tests/test_service.py`

**Interfaces:**
- Produces: `runtime.estimate_seconds(words) -> int`, `runtime.scene_word_count(lines) -> int`; `Library.scenes` rows gain `dialogue_json` + `est_seconds`; `SceneMatch` gains `scene_index` + `est_seconds`; `Library.get_scene(path, scene_index) -> dict | None`; engine `GET /scene?path=&index=` returns `{heading, characters, est_seconds, lines:[{who,text}]}`; `GET /scenes` includes `scene_index` + `est_seconds`.

- [ ] **Step 1: Runtime tests**

`tests/test_runtime.py`:
```python
from scenesearch.screenplay.runtime import estimate_seconds, scene_word_count


def test_word_count():
    assert scene_word_count([("A", "one two three"), ("B", "four five")]) == 5


def test_estimate_seconds():
    assert estimate_seconds(130) == 60   # 130 wpm
    assert estimate_seconds(0) == 0
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_runtime.py -v`
Expected: FAIL (no module).

- [ ] **Step 3: Implement runtime**

`scenesearch/screenplay/runtime.py`:
```python
from __future__ import annotations

WPM = 130


def scene_word_count(lines) -> int:
    return sum(len(text.split()) for _who, text in lines)


def estimate_seconds(words: int) -> int:
    return round(words / WPM * 60)
```

- [ ] **Step 4: Library — store dialogue + est_seconds, add get_scene**

In `scenesearch/library.py`:
- import: `from .screenplay.runtime import estimate_seconds, scene_word_count`
- `_SCHEMA` scenes table: add columns `dialogue_json TEXT, est_seconds INTEGER`.
- `SceneMatch` dataclass: add `scene_index: int = 0` and `est_seconds: int = 0`.
- In `_index_file`, when inserting a scene, also compute and store dialogue + est:
```python
        for s in scenes:
            words = scene_word_count(s.lines)
            self._conn.execute(
                "INSERT INTO scenes(script_path, scene_index, heading, page, "
                "char_count, characters_json, pairing, dialogue_json, est_seconds) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (rp, s.index, s.heading, s.page, len(s.characters),
                 json.dumps(s.characters), scene_pairing(s.characters),
                 json.dumps(s.lines), estimate_seconds(words)),
            )
```
- `query(...)` SELECT: add `s.scene_index, s.est_seconds` and pass them into `SceneMatch(...)` (extend the SELECT column list and the row unpacking).
- Add:
```python
    def get_scene(self, path, scene_index):
        row = self._conn.execute(
            "SELECT heading, characters_json, dialogue_json, est_seconds "
            "FROM scenes WHERE script_path=? AND scene_index=?",
            (str(path), scene_index)).fetchone()
        if row is None:
            return None
        heading, chars, dlg, est = row
        return {"heading": heading, "characters": json.loads(chars),
                "lines": [{"who": w, "text": t} for w, t in json.loads(dlg)],
                "est_seconds": est}
```

- [ ] **Step 5: Library test**

Append to `tests/test_library.py`:
```python
def test_get_scene_returns_lines(tmp_path):
    (tmp_path / "a.fountain").write_text(
        "INT. OFFICE - DAY\n\nMICHAEL\nSit.\n\nJENNIFER\nNo.\n")
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    m = lib.query(min_chars=2)[0]
    scene = lib.get_scene(m.script_path, m.scene_index)
    assert scene["heading"] == "INT. OFFICE - DAY"
    assert scene["lines"] == [{"who": "MICHAEL", "text": "Sit."},
                              {"who": "JENNIFER", "text": "No."}]
    assert scene["est_seconds"] >= 0
```

- [ ] **Step 6: Service — /scene + est in /scenes**

In `scenesearch/service.py`:
- In `/scenes`, add `"scene_index": m.scene_index, "est_seconds": m.est_seconds` to each scene dict.
- Add the endpoint:
```python
    @app.get("/scene")
    def scene(path: str, index: int, _=Depends(auth)):
        library = lib()
        try:
            s = library.get_scene(path, index)
        finally:
            library.close()
        if s is None:
            raise HTTPException(status_code=404, detail="no such scene")
        return s
```

- [ ] **Step 7: Service test**

Append to `tests/test_service.py`:
```python
def test_scene_endpoint_returns_lines(tmp_path):
    lib_dir = tmp_path / "lib"
    lib_dir.mkdir()
    (lib_dir / "x.fountain").write_text("INT. OFFICE - DAY\n\nMICHAEL\nSit.\n\nJENNIFER\nNo.\n")
    c = _client(tmp_path)
    c.put("/folders", headers=_auth(), json={"roots": [str(lib_dir)], "ignored": []})
    c.post("/reindex", headers=_auth())
    for _ in range(100):
        if not c.get("/reindex/status", headers=_auth()).json()["running"]:
            break
        time.sleep(0.02)
    m = c.get("/scenes", headers=_auth()).json()["scenes"][0]
    s = c.get("/scene", headers=_auth(), params={"path": m["script_path"], "index": m["scene_index"]}).json()
    assert s["lines"][0] == {"who": "MICHAEL", "text": "Sit."}
```

- [ ] **Step 8: Run all engine tests**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS (runtime/library/service/parser).

- [ ] **Step 9: Commit**

```bash
git add scenesearch/screenplay/runtime.py scenesearch/library.py scenesearch/service.py tests/test_runtime.py tests/test_library.py tests/test_service.py
git commit -m "feat: store dialogue + runtime estimate; /scene endpoint"
```

---

### Task B3: React Prepare view

**Files:**
- Modify: `app/src/renderer/src/api.ts`, `app/src/renderer/src/App.tsx`, `app/src/renderer/src/BrowseView.tsx`
- Create: `app/src/renderer/src/PrepareView.tsx`
- Modify: `app/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `GET /scene` (Task B2).
- Produces: `PrepareView` showing the selected scene's sides with a role selector + rehearse toggle; Browse's "Prepare scene →" navigates to it.

- [ ] **Step 1: api.ts — getScene + Run in Scene type**

In `app/src/renderer/src/api.ts`:
- extend `Scene` with `scene_index: number` and `est_seconds: number`.
- add to `api`:
```ts
  getScene: (path: string, index: number) =>
    call(`/scene?path=${encodeURIComponent(path)}&index=${index}`) as Promise<{
      heading: string; characters: { name: string; gender: string }[]
      est_seconds: number; lines: { who: string; text: string }[]
    }>,
```

- [ ] **Step 2: PrepareView**

`app/src/renderer/src/PrepareView.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { api, Scene } from './api'

function mmss(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function PrepareView({ scene, onBack }: { scene: Scene; onBack: () => void }) {
  const [data, setData] = useState<{ heading: string; est_seconds: number; lines: { who: string; text: string }[] } | null>(null)
  const [role, setRole] = useState('')
  const [rehearse, setRehearse] = useState(false)

  useEffect(() => {
    api.getScene(scene.script_path, scene.scene_index).then((d) => {
      setData(d)
      setRole(d.lines[0]?.who || '')
    })
  }, [scene])

  if (!data) return <div style={{ padding: 40 }}>Loading scene…</div>
  const roles = Array.from(new Set(data.lines.map((l) => l.who)))

  return (
    <div className="prepare">
      <div className="prep-head">
        <div>
          <div className="dheading">{data.heading}</div>
          <div className="dtitle">{scene.script_name.replace(/\.[^.]+$/, '')}</div>
        </div>
        <div className="prep-controls">
          <span className="muted">You read</span>
          <div className="chips">
            {roles.map((r) => (
              <button key={r} className={'chip' + (r === role ? ' on' : '')} onClick={() => setRole(r)}>{r}</button>
            ))}
          </div>
          <button className={'chip' + (rehearse ? ' on' : '')} onClick={() => setRehearse((v) => !v)}>
            {rehearse ? 'Rehearse: on' : 'Rehearse: off'}
          </button>
        </div>
      </div>

      <div className="sides-scroll">
        <div className="sides" id="sides">
          <div className="sides-h">{data.heading}</div>
          {data.lines.map((l, i) => {
            const mine = l.who === role
            return (
              <div key={i}>
                <div className={'cue' + (mine ? ' mine' : '')}>{l.who}</div>
                <div className={'sline' + (mine ? ' mine' : '')}>
                  {mine && rehearse ? '— — — — — —' : l.text}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="prep-foot">
        <button className="ghost" onClick={onBack}>← Back to results</button>
        <span className="muted">Est. {mmss(data.est_seconds)} at performance pace</span>
        <button className="btn primary" onClick={() => api.exportSides('sides', scene.script_name.replace(/\.[^.]+$/, ''))}>Export sides PDF</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: App wiring (Browse → Prepare)**

In `app/src/renderer/src/App.tsx`:
- add state: `const [prepScene, setPrepScene] = useState<import('./api').Scene | null>(null)`
- import `PrepareView`.
- render the prepare section as:
```tsx
      {section === 'prepare' && prepScene && (
        <PrepareView scene={prepScene} onBack={() => setSection('browse')} />
      )}
      {section === 'prepare' && !prepScene && (
        <div style={{ padding: 40, color: 'var(--text-3)' }}>Select a scene in Browse, then “Prepare scene →”.</div>
      )}
```
In `BrowseView`, change the prop type to accept an `onPrepare(scene)` callback and call it from the Prepare button; in `App.tsx` pass:
```tsx
        {section === 'browse' && <BrowseView search={search} onPrepare={(s) => { setPrepScene(s); setSection('prepare') }} />}
```

- [ ] **Step 4: BrowseView — onPrepare prop**

In `app/src/renderer/src/BrowseView.tsx`:
- change the signature to `export function BrowseView({ search, onPrepare }: { search: string; onPrepare: (s: Scene) => void }) {`
- change the Prepare button to: `<button className="prepare" onClick={() => onPrepare(sel)}>Prepare scene →</button>`

- [ ] **Step 5: styles for Prepare**

Append to `app/src/renderer/src/styles.css`:
```css
.prepare{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--rail)}
.prep-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:22px 30px;border-bottom:1px solid var(--border);background:var(--panel)}
.prep-controls{display:flex;align-items:center;gap:10px}
.muted{font-size:12px;color:var(--text-3)}
.sides-scroll{flex:1;overflow:auto;display:flex;justify-content:center;padding:30px}
.sides{width:640px;background:var(--window);border:1px solid var(--border);border-radius:12px;padding:46px 64px 60px}
.sides-h{font:700 13px/1 'Courier Prime',monospace;margin-bottom:26px;letter-spacing:.04em}
.sides .cue{font:400 14px/1.3 'Courier Prime',monospace;margin-left:34%;letter-spacing:.04em;color:var(--text-2);margin-top:14px}
.sides .cue.mine{color:var(--accent-text);font-weight:700}
.sides .sline{font:400 14px/1.7 'Courier Prime',monospace;margin-left:14%;width:74%;margin-bottom:8px;color:var(--text)}
.sides .sline.mine{background:var(--accent-soft);border-radius:6px;padding:4px 10px}
.prep-foot{display:flex;align-items:center;gap:14px;padding:14px 30px;border-top:1px solid var(--border);background:var(--panel)}
.prep-foot .muted{flex:1;text-align:right}
```

- [ ] **Step 6: Typecheck**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (note: `api.exportSides` is added in Task B4 — if typecheck runs before B4, add the method stub first; this plan adds B4 next, so run typecheck after B4).

- [ ] **Step 7: Commit**

```bash
git add app/src/renderer/src/PrepareView.tsx app/src/renderer/src/App.tsx app/src/renderer/src/BrowseView.tsx app/src/renderer/src/api.ts app/src/renderer/src/styles.css
git commit -m "feat: React Prepare/Sides view (role select + rehearse)"
```

---

### Task B4: Export sides to PDF

**Files:**
- Modify: `app/src/main/index.ts`, `app/src/preload/index.ts`, `app/src/renderer/src/api.ts`

**Interfaces:**
- Produces: `window.scripty.exportSides(elementId, suggestedName)` → renders the on-screen `#sides` element to a PDF via Electron and saves it through a dialog.

- [ ] **Step 1: Main — printToPDF of the sides HTML**

In `app/src/main/index.ts`, add an IPC handler (after `pick-folder`):
```ts
  ipcMain.handle('export-sides', async (_e, html: string, name: string) => {
    const r = await dialog.showSaveDialog({ defaultPath: `${name} - sides.pdf` })
    if (r.canceled || !r.filePath) return false
    const pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const data = await pdfWin.webContents.printToPDF({ printBackground: true })
    const { writeFile } = await import('fs/promises')
    await writeFile(r.filePath, data)
    pdfWin.destroy()
    return true
  })
```

- [ ] **Step 2: Preload + api**

In `app/src/preload/index.ts`, add to the exposed object:
```ts
  exportSides: (html: string, name: string) => ipcRenderer.invoke('export-sides', html, name)
```
In `app/src/renderer/src/api.ts`, extend the `Window['scripty']` type with `exportSides: (html: string, name: string) => Promise<boolean>` and add to `api`:
```ts
  exportSides: (elementId: string, name: string) => {
    const el = document.getElementById(elementId)
    const css = '<style>body{font-family:"Courier Prime",monospace;color:#111;margin:48px} .cue{margin-left:34%} .sline{margin-left:14%;width:74%;margin-bottom:10px} .sline.mine{background:#eee;border-radius:6px;padding:4px 10px}</style>'
    const html = '<html><head>' + css + '</head><body>' + (el?.outerHTML || '') + '</body></html>'
    return window.scripty.exportSides(html, name)
  },
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/index.ts app/src/preload/index.ts app/src/renderer/src/api.ts
git commit -m "feat: export sides to PDF via Electron printToPDF"
```

- [ ] **Step 5: Verify (user-run)**

The user runs `npm run dev`, opens a scene → Prepare → picks a role → toggles Rehearse (their lines blank out) → Export sides PDF → a PDF saves with the scene's sides.

---

## Self-Review

**Spec coverage (Phase 3):**
- electron-updater launch + manual check + install → Tasks A1–A2. ✓
- electron-builder GitHub publish of signed artifacts → Tasks A1, A3. ✓
- Parser dialogue extraction → Task B1. ✓
- Runtime estimate + store dialogue + /scene endpoint + Run in /scenes → Task B2. ✓
- Prepare/Sides view (role select, rehearse) → Task B3. ✓
- Export sides PDF → Task B4. ✓

**Placeholder scan:** Engine tasks are full TDD; Electron/React tasks give complete code; the auto-update + PDF runtime behavior is verified by the user (guardrail), with exact steps. No TBDs.

**Type consistency:** `Scene.lines: list[tuple[str,str]]` (B1) consumed by `scene_word_count`/library (B2). `SceneMatch.scene_index/est_seconds` (B2) used by `/scenes` + `/scene` (B2) and the React `Scene`/`getScene` (B3). `Library.get_scene(path, scene_index)` consistent B2. `window.scripty.exportSides(html,name)` consistent across main/preload/api (B4) and called by PrepareView via `api.exportSides('sides', name)` (B3). `setupUpdater(getWindow)`/`checkForUpdatesManual()` consistent A2.
