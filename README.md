# Scripty

A native macOS app that finds, browses, and prepares movie scripts on your Mac —
fully offline. **Electron + React + TypeScript**, with the screenplay engine running
in the Electron main process (no sidecar, no Python).

## Architecture

```
Electron main (Node)  ── engine/ (TypeScript) ──  in-memory index (JSON on disk)
React renderer  ──  ipcRenderer.invoke(eng:*)  ──►  engine
```

- **Engine** (`app/src/main/engine/`): scanner, text extraction (pdfjs-dist /
  mammoth / fast-xml-parser / fs), screenplay parser, gender inference, runtime
  estimate, and an in-memory `Library` (index, query, duplicate folding, add).
  Persisted as JSON in the app's `userData`. Pure TS, unit-tested with vitest.
- **App** (`app/`): Electron + Vite + React. The main process hosts the engine
  and exposes it to the renderer over `eng:*` IPC (no HTTP, no token). Starts
  instantly — there is no separate process to spawn.

## Develop

```bash
cd app
npm install
npx vitest run          # engine tests
npm run dev             # launches Electron
```

`npm run dev` opens the window and shows **Library** (point it at folders,
Re-index), **Browse** (filter scenes; PDF / Full scene / Dialogue views), and
**Prepare** (sides). Drag a script onto the window to add it. Appearance
(Light/Dark/System) and update checks are in Settings.

## Package a signed release (both architectures)

```bash
cd app && npm install && cd ..      # one-time
./packaging/build_app.sh             # builds, signs + notarizes arm64 AND Intel
# -> app/dist/Scripty-<version>-arm64.dmg  and  Scripty-<version>.dmg (x64)
```

No engine binary to build — `build_app.sh` just runs `electron-vite build` then
`electron-builder` for both arches in one pass (so one correct `latest-mac.yml`).
Notarization uses the `scene-search-notary` keychain profile.

### Publishing an auto-updatable release

```bash
# bump app/package.json "version" first
export GH_TOKEN="$(gh auth token)"
PUBLISH=always ./packaging/build_app.sh
```

Uploads the signed `.dmg`/`.zip` + `latest-mac.yml` to a GitHub release;
installed apps (kept in Applications) update on next launch via electron-updater.
**Check for Updates…** in Settings triggers a manual check.

## Notes

- Offline-only: no external network calls except the GitHub update check.
  Reads `.pdf .fountain .fdx .txt .docx`; scanned image-only PDFs can't be read.
- The Python sidecar (and the earlier PySide6 UI) were retired in favor of this
  pure-JS app; both remain in git history.
