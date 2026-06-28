# Scripty Redesign (from "Scene Search")

**Date:** 2026-06-28
**Status:** Approved design, pending implementation plan

## Purpose

Rebrand the app to **Scripty** and rebuild its UI around the "Cue v2" design: a
themed (light/dark) single-window app with a left nav rail (**Browse · Prepare ·
Library**), replacing the current Search/Finder tab layout. Add a **Prepare /
Sides** rehearsal mode. Keep everything fully offline.

Source design: claude.ai/design project `66ee3a4a-…`, file
`Scene Search - Cue v2.dc.html`.

## Brand & update continuity

- App surface becomes **Scripty**: window title, toolbar logo, About text,
  bundle display name, and the built `.app` is `Scripty.app`.
- **The updater keeps polling the existing `gleyzeddonut/scene-search` GitHub
  repo** so the installed 1.4.1 "Scene Search.app" can still find the next
  release. The repo is NOT renamed.
- Release zips become `Scripty-macOS-arm64.zip` / `Scripty-macOS-x86_64.zip`.
  `updater.parse_release` already matches by arch substring + `.zip`, so this
  keeps working.
- **Rename migration:** `write_swap_script` is changed so the new bundle is
  installed under *its own* basename in the old bundle's parent directory (then
  the old bundle is removed and the new one opened). So updating the installed
  "Scene Search.app" replaces it with "Scripty.app" cleanly; same-name updates
  are unchanged.

## Fidelity

Faithful to the mockup's structure, palette, and type — not pixel-identical
(native Qt, real macOS title bar, no oklch, fonts render differently). A
follow-up refinement pass against the running app is expected.

## Architecture

GUI-free core (unit-tested) + thin Qt views, as today.

```
scenesearch/                     (package name kept internally; brand is "Scripty")
  version.py
  screenplay/
    parser.py        # EXTENDED: Scene now carries dialogue lines
    gender.py
    runtime.py       # NEW: estimate_seconds(words) and helpers
  library.py         # EXTENDED schema: dialogue + est_seconds per scene
  finder.py          # filter model (scene/script rows) — Length filter added
  settings.py        # + theme persistence
  fonts/             # NEW: bundled Space Grotesk + Courier Prime (OFL)
  ui/
    theme.py         # NEW: light/dark palettes (hex) + QSS builder + font load
    app_shell.py     # NEW: toolbar (logo, search, theme toggle) + nav rail + stacked views
    browse_view.py   # NEW: filters + scene list + detail panel (replaces finder_tab grid)
    prepare_view.py  # NEW: sides view (role select, rehearse, export PDF)
    library_view.py  # NEW: indexing stats + folders + reindex (from finder_tab/search_tab)
    main_window.py   # hosts app_shell; keeps menus + updater banner
    sides_pdf.py     # NEW: render a scene's sides to a PDF (QPdfWriter/QTextDocument)
    index_worker.py  # reused
    update_*.py, settings_dialog.py  # reused
packaging/
  Scene Search.spec  # renamed app, reads version; bundles fonts
  build_release.sh   # APP_NAME -> Scripty
```

The old `search_tab.py` / `finder_tab.py` are superseded; their behaviors move
into `browse_view.py` and `library_view.py`. The bulk file-management actions
(copy/move/rename/delete-to-trash, stack delete) are **not** carried over for
now — the detail panel keeps **Open file** and **Reveal in Finder**.

## Theming (`ui/theme.py`)

- Two palette dicts (`LIGHT`, `DARK`) with the mockup's tokens converted to hex:
  `app_bg, chrome, rail, nav, panel, window, border, border_soft, text, text_2,
  text_3, accent, accent_soft, accent_text, chip, sel, field`, plus gender colors
  `w_bg/w_fg` (woman) and `m_bg/m_fg` (man).
- `build_qss(palette) -> str` produces the app stylesheet from a palette.
- `load_fonts()` registers the bundled `.ttf`s via `QFontDatabase.addApplicationFont`
  (Space Grotesk for UI, Courier Prime for script/monospace text).
- Theme choice persists via `Settings.get_theme()/set_theme()` (`"light"`/`"dark"`,
  default `"light"`); the toolbar toggle and re-applies QSS live.
- Fonts are OFL-licensed; the `.ttf` files are committed (like `names_gender.json`)
  and added to the PyInstaller spec `datas`.

## Engine changes

### `screenplay/parser.py` — dialogue capture
- `Scene` gains `lines: list[Line]` where `Line = (speaker: str, text: str)`.
- After detecting a character cue, the parser collects the following dialogue
  block (non-empty lines until the next cue / scene heading / blank gap) as that
  speaker's line, stripping parentheticals/wrylies on their own lines.
- Existing behavior (scene split, distinct speakers, page) is unchanged; `lines`
  is additive.

### `screenplay/runtime.py` — estimated runtime
- `estimate_seconds(word_count: int) -> int` using a performance pace
  (~130 words/minute). `scene_word_count(lines) -> int`.
- Displayed as `m:ss`; used for the Browse "Run" column and the Length filter.

### `library.py` — schema additions
- `scenes` table gains `dialogue_json` (the lines) and `est_seconds`.
- `SceneMatch` gains `lines: list[tuple[str,str]]` and `est_seconds: int`.
- `query(...)` gains optional `min_seconds`/`max_seconds` (Length filter).
- Reindex repopulates; the db is recreated if the schema version differs.

### `finder.py`
- `FilterSpec` gains `min_seconds`/`max_seconds`. `scene_rows`/`script_rows`
  unchanged otherwise; duplicate folding (`group_duplicates`) preserved.

## UI components

### `ui/app_shell.py`
- A toolbar row under the native title bar: **Scripty** wordmark + accent dot, a
  search field (filters the Browse list by name/heading for now; full-text is a
  later phase), and a light/dark **theme toggle**.
- A left **nav rail** (Browse / Prepare / Library icons+labels) switching a
  `QStackedWidget` of the three views.
- Owns the shared `Settings`, `Library`, and current selection; applies the QSS
  theme and re-applies on toggle.

### `ui/browse_view.py`
- Left: collapsible filter sections — **Scene size** (min/max speaking chars),
  **Partner pairing** (Any/M+W/M+M/W+W/has-unknown), **Length** (runtime buckets).
  Active-filter chips + sort control in the list header.
- Middle: scene list — film/name · heading · page · cast gender chips · Run
  (est). Duplicate stacks fold into expandable rows.
- Right: detail panel — heading, name, tags (size/pairing), a Courier script
  preview of the first lines, and **Prepare scene →** / **Open file** /
  **Reveal in Finder**.
- Selecting a row updates the shell's current scene.

### `ui/prepare_view.py`
- Header: scene heading/name, **"You read"** role selector (the scene's speaking
  characters), and a **Rehearse** toggle.
- Body: the scene's full sides rendered in Courier (character names, dialogue),
  centered "page". In Rehearse mode the selected role's dialogue is hidden
  (replaced with a recall placeholder) so the user can practice.
- Footer: **← Back to results**, est. runtime, **Export sides PDF**.

### `ui/sides_pdf.py`
- `export_sides(scene, my_role, path)` builds a `QTextDocument` (script-formatted
  HTML) and writes it to PDF via `QPdfWriter` — no new dependency.

### `ui/library_view.py`
- Stats cards (scripts indexed, scenes parsed, duplicate stacks folded).
- Indexed-folders list with **Add folder…** / **Remove**, plus the ignore-folders
  list, and a **Re-index** button with the existing background `IndexWorker`
  (progress shown). "Last indexed" line.

### `ui/main_window.py`
- Hosts `app_shell` as the central widget; keeps the menu bar (Settings ⌘,,
  About → "Scripty vX.Y.Z", Help, Check for Updates) and the updater banner above
  the shell.

## Settings additions
- `get_theme()/set_theme()` (default `"light"`).
- Existing keys (roots, ignored, library, check_updates) unchanged. Library
  folder + ignore folders now edited from the Library view.

## Error handling
- Same offline-first posture: extraction/index failures skip per-file and are
  counted; empty/scanned PDFs still index with 0 scenes; theme/font load failures
  fall back to defaults; PDF export failures show a message.

## Testing
GUI-free, TDD:
- **parser:** dialogue capture (speaker→text, multi-line, parenthetical
  stripping) alongside existing scene/character tests.
- **runtime:** `estimate_seconds` and `scene_word_count`.
- **library:** schema with dialogue/est_seconds; `query` Length filter.
- **finder:** Length filter in `FilterSpec`.
- **theme:** `build_qss` returns a non-empty stylesheet for both palettes;
  palettes define all required tokens.
- **settings:** theme round-trip.
- **sides_pdf:** `export_sides` writes a non-empty PDF to a temp path.

Qt views verified by running the app (offscreen construction checks where useful).

## Phasing (one shippable redesign, built in order)
1. **Shell + theming + Browse + Library** (reskin of existing engine + themes,
   rebrand, updater rename migration).
2. **Prepare / Sides** (parser dialogue capture, runtime, prepare view, PDF
   export).

## Out of scope (revisit later)
- Genre / tone / era / age / medium / writer / year filters & columns (no offline
  source).
- Books / collections and export-to-PDF *of collections*.
- Full-text ⌘K search across dialogue lines.
- Bulk file management (copy/move/rename/delete) from the old Search tab.
- Frameless custom window chrome (native title bar chosen).
