# Scripty — Electron + React UI with Python Engine Sidecar

**Date:** 2026-06-28
**Status:** Approved design, pending implementation plan

## Purpose

Re-platform Scripty's UI from PySide6 to **Electron + React**, so the app can
match web designs (the Cue mockup) with near-pixel fidelity, while **reusing the
existing, tested Python engine** unchanged by running it as a local sidecar
process. No behavior of the screenplay engine changes.

## Why

The design is authored in HTML/CSS; React+CSS reproduces it directly. The hard,
hard-won parts of the app — offline screenplay detection/parsing (tuned to
`pypdf`), the SQLite index, gender inference — stay in Python so none of that
correctness is re-derived or re-validated.

## Architecture

```
Electron main (Node)
  ├─ spawns the engine sidecar (127.0.0.1, random port, per-launch token)
  ├─ owns: BrowserWindow, native menu, file dialogs, app lifecycle
  └─ kills the sidecar on quit
React renderer (Chromium)
  └─ fetch() → http://127.0.0.1:<port>  (token header)  → engine
Python engine sidecar (FastAPI/uvicorn, PyInstaller binary)
  └─ wraps existing modules: scanner, library, finder, screenplay, gender, settings
```

- **IPC:** local HTTP. The engine binds **127.0.0.1 only**, on a random free
  port chosen by Electron, and requires a per-launch random **token** in an
  `X-Scripty-Token` header. Never listens on a public interface; no remote
  access.
- The renderer is sandboxed; a **preload** script (contextBridge) exposes a
  small, typed `window.scripty` API. Folder picking and "open/reveal" that need
  OS dialogs go through Electron main via `ipcRenderer.invoke`; data calls go to
  the engine via `fetch`.

## Repository layout (monorepo, same repo)

```
scenesearch/              # Python engine (kept)
  scanner.py library.py finder.py settings.py version.py
  screenplay/ (parser, gender, names_gender.json)
  service.py              # NEW: FastAPI app + CLI entry (uvicorn)
app/                      # NEW: Electron + Vite + React + TS
  package.json
  electron/main.ts        # spawn/own sidecar, window, menu, dialogs
  electron/preload.ts     # contextBridge -> window.scripty
  src/                    # React renderer
    App.tsx main.tsx api.ts
    components/  styles/   # rebuilt from the Cue mockup CSS
  vite.config.ts  tsconfig.json  electron-builder.yml
packaging/
  build_engine.sh         # NEW: PyInstaller -> scripty-engine binary
docs/...
```

**Retired** (deleted from the build, preserved in git history): `scenesearch/ui/*`,
`scenesearch/theme.py`, `scenesearch/updater.py`, `app.py`, and the PySide6
`packaging/Scripty.spec` / `build_release.sh` / `publish_release.sh`. The
GUI-free engine modules and their tests are kept as-is.

## Engine service (`scenesearch/service.py`)

A FastAPI app, run as `python -m scenesearch.service --port P --token T` (dev) or
the bundled `scripty-engine --port P --token T` (prod). All routes require the
`X-Scripty-Token` header.

- `GET /health` → `{ "status": "ok", "version": <str> }`
- `GET /folders` → `{ "roots": [str], "ignored": [str] }`
- `PUT /folders` `{roots, ignored}` → persists via `settings.py`
- `POST /reindex` → starts a background reindex of the roots; returns immediately
- `GET /reindex/status` → `{ "running": bool, "scanned": int, "scripts": int, "scenes": int }`
- `GET /stats` → `{ "scripts": int, "scenes": int }`
- `GET /scenes` (query: `min_chars,max_chars,pairing,search`) →
  `{ "scenes": [ {script_path, script_name, heading, page, char_count,
  characters:[{name,gender}], pairing} ] }`
- `POST /open` `{path}` / `POST /reveal` `{path}` → `fileops` on the host Mac

The service owns engine-side persistence (folders, ignore list, the SQLite
index). The React side owns view state and theme (persisted in the renderer).

## Electron main (`app/electron/main.ts`)

- On `app.whenReady`: pick a free port + random token; spawn the engine
  (`python -m scenesearch.service` when `!app.isPackaged`, else the bundled
  binary in `process.resourcesPath`); poll `/health` until ready; create the
  window (Vite dev server URL in dev, built `index.html` in prod).
- Native application menu: **Scripty** (About, Settings…/⌘,), **Help** (Scripty
  Help, Check for Updates — Phase 3).
- `ipcMain.handle('pickFolder')` → `dialog.showOpenDialog`.
- On `window-all-closed` / `before-quit`: terminate the sidecar; never leave a
  zombie.

## React renderer (`app/src`)

- Rebuilds the Cue layout as components: `AppShell` (toolbar, nav rail),
  `BrowseView` (filter accordions, scene list with gender chips, detail panel),
  `LibraryView` (stats, folders, re-index). CSS adapted directly from the
  mockup (oklch, the exact palette, Space Grotesk / Courier Prime via bundled
  `@font-face`), with light/dark themes.
- `src/api.ts` wraps the engine calls using the port+token from `window.scripty`.
- Loading/empty/error states for the async engine calls.

## Phasing

1. **Phase 1 — working dev app.** `npm run dev` launches Electron + Vite +
   the engine (run as a Python module). React shell matching the mockup with
   **Browse + Library** wired to the engine (folders, reindex+progress, scene
   filtering, open/reveal). No packaging.
2. **Phase 2 — packaged & signed.** `build_engine.sh` (PyInstaller, arm64 +
   x86_64), electron-builder bundles the engine binary as an extraResource,
   builds the `.app`, **Developer-ID signs + notarizes** (existing cert + notary
   profile). Distributable `.dmg`/`.zip`.
3. **Phase 3 — auto-update + Prepare.** electron-updater (GitHub releases) and
   the Prepare/Sides feature (engine adds dialogue extraction + a sides endpoint;
   React adds the Prepare view + PDF export via the renderer).

## Error handling

- If the sidecar fails to start or `/health` never returns, the window shows an
  error state with a retry, and Electron logs the engine's stderr.
- Engine call failures surface as inline UI errors; the app stays usable.
- The sidecar is always killed on quit (tracked PID + `before-quit`).
- Engine-side per-file extraction/index failures behave exactly as today
  (skipped + counted).

## Security

- Engine bound to `127.0.0.1`, random port, per-launch token required on every
  route. No external network use anywhere (offline app).
- Renderer runs with `contextIsolation` on and `nodeIntegration` off; only the
  preload's typed API is exposed.

## Testing

- **Python engine:** existing pytest suite stays (96 tests). Add `service.py`
  API tests with FastAPI's `TestClient` (health/folders/scenes/reindex,
  token enforcement).
- **React:** light component tests are optional; the UI is verified by running
  the app. (Phase 1 success = the dev app runs, indexes a folder, and filters
  scenes.)

## Carries over vs. redone

- **Carries over:** the whole Python engine + 96 tests, `names_gender.json`, the
  Developer-ID cert + notary profile, the GitHub repo.
- **Redone:** the UI (React/CSS — the point), packaging (electron-builder),
  auto-update (electron-updater).

## Out of scope (for now)

- Rewriting the engine in JS (explicitly deferred; the sidecar keeps Python).
- Windows/Linux builds.
- The deferred feature backlog (genre/tone/era filters, Books, full-text search,
  bulk file management) is unchanged by this re-platforming.
