# Scripty

A native macOS app that finds, browses, and prepares movie scripts on your Mac —
fully offline. The UI is **Electron + React**; the screenplay engine is **Python**,
run as a local sidecar process the UI talks to over `127.0.0.1` (token-authed).

## Architecture

```
Electron main (Node)  ─ spawns ─►  Python engine sidecar (FastAPI/uvicorn)
React renderer  ── fetch(127.0.0.1:<port>, token) ──►  engine
```

- **Engine** (`scenesearch/`): the offline screenplay engine — scanner, SQLite
  index (`library`), screenplay parser, gender inference, scene filtering
  (`finder`) — exposed via `scenesearch/service.py` (FastAPI). GUI-free and
  unit-tested.
- **App** (`app/`): Electron + Vite + React + TypeScript. The main process
  spawns the engine on a random free port with a per-launch token and kills it
  on quit; the renderer calls the engine via `fetch`.

## Develop

```bash
# 1. engine
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pytest          # run the engine + service tests

# 2. app
cd app
npm install
npm run dev                         # launches Electron + the engine sidecar
```

`npm run dev` opens the window, which starts the Python engine, then shows the
**Library** (point it at folders, Re-index) and **Browse** (filter scenes by
size / gender pairing) views. Light/dark themes via the toolbar toggle.

## Status

- **Phase 1 (done):** working dev app — Electron/React shell + Python engine
  sidecar; Browse + Library.
- **Phase 2 (next):** package the engine with PyInstaller + the app with
  electron-builder; Developer-ID sign + notarize.
- **Phase 3:** auto-update (electron-updater) and the Prepare/Sides feature.

## Notes

- Offline-only: the engine binds to `127.0.0.1` and never makes external network
  calls. Detection reads `.pdf .fountain .fdx .txt .docx`; scanned image-only
  PDFs can't be read.
- The previous PySide6 UI was retired in favor of the Electron app (kept in git
  history); the Python engine and its tests carried over unchanged.
