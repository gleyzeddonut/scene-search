# Scene Search — Finder Tab (offline scene/character filtering)

**Date:** 2026-06-27
**Status:** Approved design, pending implementation plan

## Purpose

Add a second tab to Scene Search: a **Finder** that treats one chosen folder as
a script *library*, parses every script in it into structured scene/character
data once, and then lets the user filter that library — fully offline — by
things like the number of speaking characters in a scene, two-person
conversations, and the gender pairing of two-character scenes.

## Users & context

- Same single user, macOS, the existing Scene Search app.
- Fully **offline** — no LLM/API calls, no network. Privacy-preserving.
- Genre/tone detection is explicitly **out of scope** (it needs an LLM to be
  worthwhile).

## Tech stack

- Same as the app: Python 3, PySide6 (Qt).
- **SQLite** (Python stdlib `sqlite3`) for the parsed-library index.
- A bundled, public-domain **first-name → gender** dictionary (derived from US
  Social Security name data) shipped as a data file in the package.

## How it fits into the existing app

Today `app.py` shows a single `MainWindow` whose central widget is the search
UI. This changes to a **two-tab** layout:

- The current search UI is refactored from `MainWindow`'s central widget into a
  self-contained `SearchTab(QWidget)` (a pure move of existing behavior — no
  functional change).
- A new `FinderTab(QWidget)` is added.
- `MainWindow` becomes a thin shell hosting a `QTabWidget` with **Search** and
  **Finder** tabs.

This refactor is justified: `main_window.py` already holds all the search
behavior, and splitting the tab content into focused widgets keeps each file
single-purpose.

## Architecture

GUI-free core (unit-tested) + thin Qt views, mirroring the current design.

```
scenesearch/
  screenplay/
    __init__.py
    parser.py        # text -> list[Scene] (heading, page, speaking characters)
    gender.py        # first name -> "male" | "female" | "unknown"
    names_gender.json  # bundled public-domain name -> gender data
  library.py         # SQLite index: parse + store + query scenes
  finder.py          # filter model: apply filters -> scene rows / script rows
  model.py           # (existing) + Scene, SceneMatch dataclasses
  ui/
    search_tab.py    # refactored from main_window.py (existing behavior)
    finder_tab.py    # new Finder UI
    main_window.py   # now a QTabWidget shell
```

## Components

### screenplay/parser.py — `parse_scenes(text) -> list[Scene]`
- `Scene` dataclass: `heading: str`, `index: int` (1-based order), `page: int`
  (best-effort), `characters: list[str]` (distinct speaking characters, in order
  of first appearance).
- Splits the text into scenes at lines matching the scene-heading pattern
  (`INT.`/`EXT.`/`I/E` etc. — reuse the regex style from `classifier.py`).
- Within each scene, a **character cue** is an ALL-CAPS line (1–4 words, no
  sentence punctuation) immediately followed by a non-empty line (the dialogue).
  This excludes scene headings and transitions. Distinct cues = speaking
  characters.
- Character-name normalization: strip parentheticals like `(CONT'D)`, `(V.O.)`,
  `(O.S.)` and surrounding whitespace; upper-case compare so `JOHN` and
  `John (V.O.)` collapse to one character.
- Page number is approximated by counting form-feed (`\f`) markers pypdf emits
  between pages; if absent, page is `0` (unknown).

### screenplay/gender.py — `guess_gender(name) -> str`
- Returns `"male"`, `"female"`, or `"unknown"`.
- Takes the character's **first token** (first name), lower-cased, and looks it
  up in the bundled `names_gender.json`. Unrecognized → `"unknown"`.
- `scene_pairing(characters) -> str | None`: for a scene with exactly two
  characters, returns one of `"MW"`, `"MM"`, `"WW"`, `"has_unknown"`; otherwise
  `None`.

### library.py — `Library`
- Wraps a SQLite db at a given path (default `~/.scenesearch_index.db`).
- `reindex(folder, progress=None)`: walk the folder (reuse `scanner` +
  `extractors`), and for each script whose (path, mtime) isn't already current,
  parse scenes and upsert rows. Removes rows for files no longer present.
- Schema (two tables):
  - `scripts(path PRIMARY KEY, name, mtime, scene_count)`
  - `scenes(id, script_path, scene_index, heading, page, char_count,
    characters_json, pairing)` — `pairing` precomputed via `gender.scene_pairing`.
- `query(min_chars, max_chars, pairing) -> list[SceneMatch]`: SQL filter over
  `scenes`. `SceneMatch`: `script_path`, `script_name`, `heading`, `page`,
  `char_count`, `characters: list[str]`, `pairing`.
- `is_indexed() -> bool`, `script_count()`, `scene_count()` for status display.

### finder.py — filter + grouping (GUI-free)
- `FilterSpec` dataclass: `min_chars: int | None`, `max_chars: int | None`,
  `pairing: str | None` (`None` = any; or `"MW"`/`"MM"`/`"WW"`/`"has_unknown"`).
- `scene_rows(library, spec) -> list[SceneMatch]` — flat list of matching scenes.
- `script_rows(library, spec) -> list[ScriptMatch]` — matching scenes grouped by
  script. `ScriptMatch`: `script_path`, `script_name`, `match_count`.
- Keeping grouping here (not in SQL/UI) makes the toggle logic unit-testable.

### ui/finder_tab.py — `FinderTab(QWidget)`
- **Library row:** current library folder label, **Choose Library Folder…**, and
  **Index** (with progress + "N scripts, M scenes indexed" status). Folder
  persisted via the existing `Settings` (new `get_library()/set_library()`).
- **Filter row:** min/max speaking-characters spin boxes; a pairing dropdown
  (Any / Man+Woman / Man+Man / Woman+Woman / Has unknown gender).
- **Scenes ⇄ Scripts toggle** (two radio buttons or a segmented control).
- **Results table** driven by the toggle:
  - Scenes view columns: Script · Scene · Page · # Chars · Characters · Pairing.
  - Scripts view columns: Script · Matching scenes.
- Double-click a row → `fileops.open_external(script_path)`.

### ui/main_window.py — shell
- Hosts a `QTabWidget` with `SearchTab` and `FinderTab`.
- Owns the shared `Settings`; passes it to both tabs. Keeps injectable
  `settings_path`/`index_path` for tests.

## Data flow

1. User sets the library folder → click **Index**.
2. `Library.reindex` walks the folder, extracts text, `parse_scenes`, computes
   `pairing` per scene, writes to SQLite (incremental by mtime).
3. User adjusts filters / toggle → `finder.scene_rows` or `finder.script_rows`
   runs a SQL query → table repopulates instantly.
4. Double-click → open the script.

## Error handling

- Unparseable/unreadable scripts are skipped during indexing and counted (same
  spirit as the search tab's "couldn't read" count); indexing never aborts on
  one bad file.
- A scene with zero detected characters still indexes (char_count 0) so counts
  stay honest; it simply won't match character/pairing filters.
- Re-indexing is safe to run repeatedly; unchanged files are skipped via mtime.
- Corrupt index db → recreated from scratch.

## Testing

GUI-free, TDD, synthetic screenplay text:
- **parser:** scene splitting; speaker detection; parenthetical stripping
  (`JOHN (V.O.)` == `JOHN`); character counts; multi-scene scripts.
- **gender:** known male/female names; unknown bucket; `scene_pairing` for
  MW/MM/WW/has_unknown and `None` when not exactly two characters.
- **library:** reindex writes expected rows; incremental skip on unchanged
  mtime; removal of deleted files; `query` honors min/max/pairing.
- **finder:** `scene_rows` and `script_rows` grouping and counts for a given
  `FilterSpec`.

The Qt tabs stay thin enough to verify by running the app.

## Definitions (locked during design)

- **"Two-person conversation"** = a scene with **exactly two** distinct speaking
  characters (not back-and-forth alternation detection).
- **Gender** is shown as **inferred** with an explicit **"unknown"** bucket;
  never forced to a binary guess.

## Out of scope (YAGNI)

- Genre / comedy-vs-drama / tone detection.
- Any LLM/API/network use.
- Manual per-character gender correction (possible future add).
- Back-and-forth dialogue-turn analysis.
- Editing scripts from the Finder tab (open externally only).
