# Scene Search — Movie Script Finder & Manager

**Date:** 2026-06-27
**Status:** Approved design, pending implementation plan

## Purpose

A non-browser, native desktop app for macOS that scans the user's filesystem,
finds movie/TV scripts (which are mostly PDFs), confirms them by looking inside
the file, lists them in a clean sortable view, and lets the user manage those
files (copy, move, rename, open, reveal in Finder, delete to Trash) directly
from the app.

## Users & context

- Single user, on macOS 26.5, Python 3.14 available.
- Scripts are scattered across common personal folders.
- Most scripts are PDFs; the drive also contains many *non-script* PDFs, so
  detection must look inside files, not just trust the extension.

## Tech stack

- **Python 3** (already installed).
- **PySide6 (Qt)** for a modern, polished native window — chosen over Tkinter
  for nicer sortable tables and overall look.
- **pypdf** — extract text from PDFs.
- **python-docx** — extract text from `.docx`.
- **send2trash** — safe delete (moves to Trash, never permanent).

Run with `python3 app.py`.

## Architecture

Strict split between GUI-free **core** (fully unit-testable) and a thin **UI**
layer.

```
scene-search/
  app.py                  # entry point, launches the Qt app
  scenesearch/
    __init__.py
    scanner.py            # walk folders, yield candidate files
    extractors.py         # pull text from pdf/docx/txt/fountain/fdx
    classifier.py         # score how "screenplay-like" extracted text is
    fileops.py            # copy / move / rename / open / reveal / trash
    cache.py              # remember scores by path+mtime for fast re-scans
    model.py              # ScriptEntry dataclass
    ui/
      __init__.py
      main_window.py      # window, table, detail pane, action buttons
      scan_worker.py      # background QThread; streams results to the UI
  tests/
    test_scanner.py
    test_classifier.py
    test_fileops.py
  requirements.txt        # PySide6, pypdf, python-docx, send2trash
  README.md
```

**Key decision:** scanning + PDF parsing is slow, so it runs on a background
`QThread` worker that emits progress and streams each confirmed script into the
table as it is found. The window never freezes; results appear live.

## Components

### model.py — `ScriptEntry`
A dataclass describing one found script:
`path`, `name`, `folder`, `file_type`, `size_bytes`, `modified` (datetime),
`confidence` (0.0–1.0), `matched_cues` (list[str]).

### scanner.py
- Default scan roots: `~/Downloads`, `~/Desktop`, `~/Documents`, and iCloud
  Drive Documents (`~/Library/Mobile Documents/com~apple~CloudDocs/Documents`).
- Plus any extra user-added folders.
- Recursively walks roots, skipping noise: hidden dirs, `node_modules`, `.git`,
  `Library/Caches`, system paths, app bundles (`*.app`), etc.
- Yields candidate file paths whose extension is one of
  `.pdf .fountain .fdx .txt .docx`.

### extractors.py
- `extract_text(path) -> str` dispatches by extension:
  - `.pdf` → pypdf, first N pages (default ~8) for speed.
  - `.docx` → python-docx paragraphs.
  - `.txt` / `.fountain` → read directly (capped length).
  - `.fdx` → parse XML, pull paragraph text.
- On failure (encrypted PDF, corrupt file, permission denied) raises a typed
  `ExtractionError` carrying the reason; callers handle it gracefully.
- Returns empty string for image-only PDFs that contain no extractable text.

### classifier.py
- `score(text) -> (confidence: float, cues: list[str])`.
- Heuristic weighted signals:
  - `INT.` / `EXT.` / `I/E` scene headings (strongest signal).
  - Transitions: `FADE IN`, `FADE OUT`, `CUT TO:`, `DISSOLVE TO:`.
  - ALL-CAPS character-cue lines (short, uppercase).
  - Title-page phrases: "written by", "screenplay by", "story by".
- Normalizes to 0.0–1.0. A file is shown only if confidence ≥ threshold
  (default tuned so a couple of real scene headings clears the bar).
- Returns the specific cues it matched, for display in the detail pane.

### cache.py
- Lightweight JSON (or sqlite) cache keyed by `path + mtime + size` → stored
  `confidence` + `cues`.
- On re-scan, unchanged files skip re-extraction/scoring. Stale entries (file
  moved/changed) are recomputed.
- Purely an optimization; correctness never depends on it.

### fileops.py
GUI-free operations, each returning a clear success/failure result:
- `open_external(path)` — launch the OS default app (`open` / QDesktopServices).
- `reveal_in_finder(path)` — `open -R`.
- `rename(path, new_name)` — with collision check.
- `copy_to(path, dest_dir)` / `move_to(path, dest_dir)` — collision handling
  by auto-suffix or caller-supplied resolution.
- `delete_to_trash(path)` — via `send2trash`; never permanent deletion.

### ui/main_window.py
Single main window:
- **Top bar:** Scan button, editable folder list (add/remove roots), progress
  bar, filter-by-name box, and a "couldn't read text" indicator count.
- **Center:** sortable table — Name · Folder · Type · Size · Modified ·
  Confidence.
- **Detail pane:** for the selected row — full path, matched cues, and action
  buttons (Open, Reveal in Finder, Rename, Copy to…, Move to…, Delete to Trash).

### ui/scan_worker.py
- `QThread`/worker object that runs scanner → extractor → classifier.
- Emits signals: `progress(scanned_count, current_path)`,
  `found(ScriptEntry)`, `unreadable(path, reason)`, `finished(summary)`.
- Cancellable mid-scan.

## Data flow

1. User clicks Scan (with the current folder roots).
2. Worker thread walks roots → candidate files.
3. For each candidate: check cache; if stale/missing, extract text → score.
4. If confidence ≥ threshold → emit `found(ScriptEntry)`; UI appends a row live.
5. If text couldn't be read → emit `unreadable`; UI bumps the count.
6. On completion → `finished(summary)` shows totals.
7. User selects a row → detail pane → performs file actions via `fileops`.

## Error handling & safety

- Extraction failures are caught per-file, never abort the scan, and are
  surfaced in the "couldn't read text" count.
- Image-only (scanned) PDFs can't be content-confirmed; this is a documented
  limitation. OCR is explicitly out of scope.
- Destructive actions (Move, Delete) confirm before acting.
- Delete is always **move to Trash** (`send2trash`), never permanent.
- Copy/Move resolve name collisions rather than overwriting silently.
- File-permission errors are reported to the user, not swallowed.

## Testing

Because core is GUI-free it is unit-tested directly:
- **classifier:** real screenplay text scores high; receipts/articles/manuals
  score low; cue extraction is correct.
- **scanner:** skip rules exclude junk; extension filter correct; extra roots
  respected.
- **fileops:** copy/move/rename/trash in temp directories, including collision
  handling and error paths.
- **extractors:** per-format extraction on small fixture files; ExtractionError
  on a deliberately broken file.

The Qt layer stays thin enough to verify manually by running the app.

## Out of scope (YAGNI)

- OCR of scanned/image PDFs.
- In-app editing of script *contents* (rename only; contents edited externally).
- Tags/notes/metadata storage.
- Whole-drive scanning and Full Disk Access flows.
- Cross-platform (Windows/Linux) packaging — macOS first.
