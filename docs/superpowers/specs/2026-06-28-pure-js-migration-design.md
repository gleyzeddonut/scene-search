# Pure-JS Migration — Drop the Python Sidecar (Design)

**Date:** 2026-06-28
**Status:** Approved (design)

## Goal

Replace the Python engine sidecar with TypeScript modules running in the Electron
main process, so Scripty becomes a pure Electron + React app with **no Python, no
PyInstaller, no HTTP/CORS/token/port layer, and no native modules**. This is a
**faithful port first** (feature + behavior parity, same UI); parser *heuristic*
improvements (sides-style docs, etc.) are a deliberate follow-up, not part of this
migration. pdf.js extraction (better than pypdf for awkward PDFs) comes for free.

## Why

The sidecar has been the source of a recurring class of bugs and weight:
CORS, "database is locked", blank-on-startup (window waited for the engine),
~5–8s cold start, ~100 MB of bundled engine binaries (×2 arches), PyInstaller
fragility, and port/token/health plumbing. Moving the logic in-process and the
index in-memory **eliminates that entire class by construction** and shrinks the
app substantially.

## Non-Goals (this migration)

- New parser heuristics (sides documents without `INT./EXT.`, smarter cue
  detection). Tracked as a follow-up; the messy real files (e.g. the sides
  `.docx`) become test cases then.
- OCR for image-only PDFs.
- Auto-update / Prepare changes (already shipped; carried over untouched).
- Any UI redesign. The renderer stays as-is except its transport.

## Architecture

```
Electron main process (Node)                 Renderer (React, unchanged UI)
┌───────────────────────────────┐            ┌───────────────────────────┐
│ engine/ (TS modules)          │            │ AppShell / Browse /       │
│  scanner  extract  parser     │  IPC        │ Prepare / Library /       │
│  gender   runtime  library    │◀──invoke───▶│ Settings / PdfFrame       │
│  store (JSON persistence)     │            │ api.ts (ipc, not fetch)   │
│  in-memory index + state      │            └───────────────────────────┘
└───────────────────────────────┘
```

- The renderer calls the engine via `ipcRenderer.invoke(...)` (exposed through
  the existing `contextBridge` preload). No localhost HTTP server.
- Indexing is an **async loop** in main that updates an in-memory `state`
  (running / scanned / scripts / scenes / errors / cancel). Reads query the
  in-memory index directly → instant, never blocked by indexing.

## Components

All under `app/src/main/engine/`. Each mirrors a current Python module and is
independently testable.

### `extract.ts`
`extractText(path) -> Promise<string>` and `extractPaginated(path) -> Promise<string>`.
- `.pdf` → **pdfjs-dist** (legacy build for Node): load doc, for each page
  `getTextContent()`, join items into lines, join pages with `\f` (so scene page
  numbers can be recovered). Cap at ~400 pages / 400k chars.
- `.docx` → **mammoth** `extractRawText` → text.
- `.fdx` → **fast-xml-parser**: collect all `<Text>` node values, join with `\n`.
- `.txt` / `.fountain` → `fs.readFile` utf-8.
- Unknown / unreadable → throw `ExtractionError` (caught upstream).

### `parser.ts`
`parseScenes(text) -> Scene[]` — direct port of `parse_scenes`:
scene-heading regex (`INT./EXT.` with optional scene number), cue detection
(`_isCue`), dialogue capture, action/description blocks, page counting on `\f`.
`Scene = { heading, index, page, characters[], lines[[who,text]], blocks[] }`.

### `gender.ts`
`guessGender(name) -> 'male'|'female'|'unknown'` and
`scenePairing(names) -> 'MW'|'MM'|'WW'|'has_unknown'|null` (null unless exactly 2),
using a bundled `names_gender.json` (moved into `app/src/main/engine/data/`).

### `runtime.ts`
`sceneWordCount(lines) -> number`, `estimateSeconds(words) -> number` (130 wpm).

### `scanner.ts`
`iterCandidates(roots, { ignoreDirs, shouldCancel, onError }) -> Asyncgenerator<string>`.
Walks folders (built-in `fs` recursive walk), filters to script extensions,
skips noise dirs (`node_modules`, `.git`, `Library`, …) and `.app` bundles,
checks `shouldCancel` between directories, reports unreadable dirs via `onError`.

### `library.ts`
The in-memory index + operations:
- `Index = { scripts: Map<path, ScriptRow>, scenes: SceneRow[] }`.
- `reindex(folders, opts)` — incremental by mtime; per-file `try/catch` (skip bad
  files, report via `onError`); prune deleted (skip `pinned`); fold re-download
  copies (`canonicalKey`) at query time; bump an index-version for full re-parse
  after upgrades.
- `query({ minChars, maxChars, pairing })`, `getScene(path, index)`,
  `addFile(path) -> 'added'|'exists'|'not_script'|'unreadable'` (pinned).
- `scriptCount()`, `sceneCount()`.

### `store.ts`
- `userData/scripty/settings.json` ({ roots, ignored }); on first run, migrate
  from `~/.scripty_settings.json` if present.
- `userData/scripty/index.json` — persisted index (load on startup, save after
  reindex/add). The old `~/.scripty_index.db` is ignored.

## IPC surface (parity with today's HTTP routes)

`getFolders`, `setFolders`, `stats`, `scenes(filters)`, `scene(path, index)`,
`reindex`, `reindexStatus`, `reindexStop`, `add(path)`, `open(path)`,
`reveal(path)` — registered with `ipcMain.handle`, exposed via preload, called by
`api.ts`. The engine no longer needs a token (it's in-process); `read-file`
(PDF bytes) and `export-sides` stay as they are.

## Data flow

- Browse: `invoke('scenes', filters)` → `library.query` (folded) → scenes.
- Detail/Prepare: `invoke('scene', path, index)` → `library.getScene`.
- Reindex: `invoke('reindex')` starts the async loop; renderer polls
  `invoke('reindexStatus')`; `invoke('reindexStop')` sets the cancel flag.
- Drag-drop add: `invoke('add', path)`.
- PDF view: unchanged (`read-file` IPC → blob URL in `PdfFrame`).

## Packaging changes

Remove: `packaging/scripty-engine.spec`, `engine_entry.py`, `build_engine.sh`,
the `dist-engine` extraResources and dual-arch engine steps, engine entitlements.
`build_app.sh` becomes “build renderer + electron-builder (arm64 + x64)”. No
native modules (pdfjs/mammoth/xml are pure JS; index is JSON), so packaging is
straightforward and the app is ~100 MB smaller with instant startup.

## Error handling

- Per-file `try/catch` in reindex — one bad file never aborts the index.
- Unreadable folders reported (the amber warning we already show).
- Extraction errors → file skipped (0 scenes), surfaced in the error list.
- IPC handlers wrap work so a failure returns a clean error, not a crash.

## Testing

Port the existing 109 Python tests to **vitest** under `app/src/main/engine/__tests__/`:
parser (headings, cues, dialogue, action blocks), extract (sample `.txt`/`.fountain`/
`.fdx`; a generated `.docx`; a small text `.pdf`), gender/pairing, runtime,
library (incremental, fold copies, cancel, add_file, bad-file resilience,
prune-respects-pinned). The Python suite is the behavior spec for parity.
**vitest runs directly via `npx vitest run`** (not blocked by the build guardrail),
so the engine stays fully covered; only the electron-builder packaging is user-run.

## Migration / rollout

1. Build the TS engine + vitest suite (green) with no UI wired yet.
2. Add IPC handlers + preload; switch `api.ts` from fetch to invoke.
3. Delete the Python engine, `scenesearch/`, sidecar spawn, HTTP/CORS/token, and
   the PyInstaller packaging. Bump version (1.6.0).
4. User runs `npm install` (new deps: pdfjs-dist, mammoth, fast-xml-parser) and a
   dev smoke test, then a packaged build.

## Risks

- **PDF parity:** pdfjs text differs slightly from pypdf (usually better). Scene
  counts may shift a little; acceptable and verified against real files.
- **pdfjs in Node main process:** use the legacy/Node build and disable the
  worker (or run with a fake worker) so it runs in the main process.
- **mammoth/docx fidelity:** raw-text extraction is close to python-docx.
- All mitigated by the vitest parity suite + a dev smoke test before packaging.
