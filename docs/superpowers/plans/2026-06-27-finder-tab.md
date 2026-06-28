# Finder Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second "Finder" tab that indexes a chosen script library and filters it offline by # speaking characters per scene and gender pairing, with a Scenes⇄Scripts toggle.

**Architecture:** A GUI-free core (screenplay parser, offline name→gender lookup, SQLite library index, filter model) plus a thin Qt `FinderTab`. The existing search UI is refactored into a `SearchTab` widget, and `MainWindow` becomes a `QTabWidget` shell hosting both.

**Tech Stack:** Python 3, PySide6 (Qt), `sqlite3` (stdlib), a bundled public-domain first-name→gender JSON.

## Global Constraints

- Fully **offline** — no LLM, no API, no network at runtime.
- Core modules under `scenesearch/` must not import PySide6 (only `scenesearch/ui/` and `app.py` may).
- "Two-person conversation" = a scene with **exactly two** distinct speaking characters.
- Gender is `"male"`, `"female"`, or `"unknown"` — never forced to a binary guess.
- Pairing codes are exactly `"MW"`, `"MM"`, `"WW"`, `"has_unknown"` (or `None` = not a 2-character scene / no filter).
- Genre/tone detection, manual gender correction, and dialogue-turn analysis are out of scope.
- Tests use synthetic screenplay text; TDD; frequent commits.

---

### Task 1: Screenplay parser

**Files:**
- Create: `scenesearch/screenplay/__init__.py`
- Create: `scenesearch/screenplay/parser.py`
- Test: `tests/test_parser.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Scene` dataclass (`heading: str`, `index: int`, `page: int`, `characters: list[str]`); `parse_scenes(text: str) -> list[Scene]`. Scenes split at `INT./EXT.` headings; `characters` are distinct speaking characters (ALL-CAPS cues above dialogue), parentheticals like `(V.O.)` stripped, upper-cased. `page` = 1-based page from form-feed (`\f`) counting, or `0` if the text has no form feeds.

- [ ] **Step 1: Create the package init**

`scenesearch/screenplay/__init__.py`:
```python
"""Offline screenplay parsing and analysis."""
```

- [ ] **Step 2: Write the failing tests**

`tests/test_parser.py`:
```python
from scenesearch.screenplay.parser import parse_scenes

SCRIPT = """\
INT. DINER - DAY

NEIL sits down at the counter.

NEIL
Coffee, black.

EADY
Coming right up.

EXT. STREET - NIGHT

A man walks alone.

VINCENT
Anybody there?
"""


def test_splits_on_scene_headings():
    scenes = parse_scenes(SCRIPT)
    assert [s.heading for s in scenes] == ["INT. DINER - DAY", "EXT. STREET - NIGHT"]
    assert [s.index for s in scenes] == [1, 2]


def test_distinct_speaking_characters_per_scene():
    scenes = parse_scenes(SCRIPT)
    assert scenes[0].characters == ["NEIL", "EADY"]
    assert scenes[1].characters == ["VINCENT"]


def test_action_line_in_caps_is_not_a_character():
    # "NEIL sits down..." has lowercase, so it is not a cue; NEIL only counts
    # from the real cue above dialogue.
    assert parse_scenes(SCRIPT)[0].characters == ["NEIL", "EADY"]


def test_parentheticals_collapse_to_one_character():
    text = "INT. ROOM - DAY\n\nJANE (V.O.)\nHello?\n\nJANE\nGoodbye.\n"
    assert parse_scenes(text)[0].characters == ["JANE"]


def test_pages_from_form_feeds():
    text = "INT. A - DAY\n\nBOB\nHi.\n\fINT. B - DAY\n\nSUE\nYo.\n"
    scenes = parse_scenes(text)
    assert scenes[0].page == 1
    assert scenes[1].page == 2


def test_no_form_feeds_means_page_zero():
    assert parse_scenes(SCRIPT)[0].page == 0


def test_empty_text():
    assert parse_scenes("") == []
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_parser.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.screenplay.parser'`.

- [ ] **Step 4: Write minimal implementation**

`scenesearch/screenplay/parser.py`:
```python
from __future__ import annotations

import re
from dataclasses import dataclass, field

_SCENE_RE = re.compile(
    r"^\s*(INT\.?/EXT\.?|EXT\.?/INT\.?|INT|EXT|I/E|E/I)[\.\s]", re.IGNORECASE
)
_TRANSITION_RE = re.compile(
    r"\b(FADE IN|FADE OUT|FADE TO BLACK|CUT TO|SMASH CUT|MATCH CUT|DISSOLVE TO)\b"
)
_CUE_RE = re.compile(r"^[ \t]*[A-Z][A-Z0-9 .'\-]{0,30}(\([^)]*\))?[ \t]*$")
_PAREN_RE = re.compile(r"\([^)]*\)")


@dataclass
class Scene:
    heading: str
    index: int
    page: int
    characters: list[str] = field(default_factory=list)


def _normalize_character(text: str) -> str:
    name = _PAREN_RE.sub("", text)
    return " ".join(name.split()).upper()


def _next_nonempty(lines: list[str], start: int) -> str | None:
    for j in range(start, len(lines)):
        if lines[j].strip():
            return lines[j]
    return None


def _is_cue(line: str) -> bool:
    stripped = line.strip()
    if not stripped or _SCENE_RE.match(line) or _TRANSITION_RE.search(stripped):
        return False
    if not _CUE_RE.match(line):
        return False
    name = _normalize_character(stripped)
    words = name.split()
    return 1 <= len(words) <= 4 and any(c.isalpha() for c in name)


def parse_scenes(text: str) -> list[Scene]:
    if not text:
        return []
    has_pages = "\f" in text
    lines = text.split("\n")
    scenes: list[Scene] = []
    current: Scene | None = None
    seen: set[str] = set()
    page = 1
    for i, raw in enumerate(lines):
        page += raw.count("\f")
        if _SCENE_RE.match(raw):
            current = Scene(
                heading=" ".join(raw.split()),
                index=len(scenes) + 1,
                page=page if has_pages else 0,
            )
            scenes.append(current)
            seen = set()
            continue
        if current is None:
            continue
        if _is_cue(raw):
            nxt = _next_nonempty(lines, i + 1)
            if nxt is None or _SCENE_RE.match(nxt):
                continue
            name = _normalize_character(raw)
            if name not in seen:
                seen.add(name)
                current.characters.append(name)
    return scenes
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_parser.py -v`
Expected: PASS (7 passed).

- [ ] **Step 6: Commit**

```bash
git add scenesearch/screenplay/__init__.py scenesearch/screenplay/parser.py tests/test_parser.py
git commit -m "feat: add offline screenplay scene/character parser"
```

---

### Task 2: Name→gender lookup + bundled data

**Files:**
- Create: `packaging/build_names_gender.py`
- Create: `scenesearch/screenplay/names_gender.json` (generated)
- Create: `scenesearch/screenplay/gender.py`
- Modify: `packaging/Scene Search.spec` (bundle the json)
- Test: `tests/test_gender.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `guess_gender(name: str) -> str` (`"male"`/`"female"`/`"unknown"`); `gender_from_table(name, table: dict) -> str` (pure, testable); `pairing_from_genders(genders: list[str]) -> str | None`; `scene_pairing(characters: list[str]) -> str | None` returning `"MW"`/`"MM"`/`"WW"`/`"has_unknown"` for exactly-two-character scenes, else `None`.

- [ ] **Step 1: Write the data generator**

`packaging/build_names_gender.py`:
```python
"""Build scenesearch/screenplay/names_gender.json from the public-domain US
Social Security baby-name dataset. Run once: `.venv/bin/python packaging/build_names_gender.py`."""
import collections
import io
import json
import urllib.request
import zipfile
from pathlib import Path

URL = "https://www.ssa.gov/oact/babynames/names.zip"
OUT = Path(__file__).resolve().parents[1] / "scenesearch" / "screenplay" / "names_gender.json"


def main() -> None:
    data = urllib.request.urlopen(URL, timeout=120).read()
    counts: dict[str, dict[str, int]] = collections.defaultdict(lambda: {"M": 0, "F": 0})
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for entry in z.namelist():
            if not entry.endswith(".txt"):
                continue
            for line in z.read(entry).decode().splitlines():
                parts = line.split(",")
                if len(parts) != 3:
                    continue
                name, sex, count = parts
                counts[name.lower()][sex] += int(count)
    table: dict[str, str] = {}
    for name, c in counts.items():
        total = c["M"] + c["F"]
        if total < 100:  # drop very rare names
            continue
        if c["M"] >= 0.95 * total:
            table[name] = "male"
        elif c["F"] >= 0.95 * total:
            table[name] = "female"
        # otherwise ambiguous -> omit so it resolves to "unknown"
    OUT.write_text(json.dumps(table, separators=(",", ":"), sort_keys=True))
    print(f"wrote {len(table)} names to {OUT}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate the data file**

Run: `.venv/bin/python packaging/build_names_gender.py`
Expected: prints `wrote <N> names to .../names_gender.json` (N in the low tens of thousands). Confirm the file exists:
Run: `ls -lh "scenesearch/screenplay/names_gender.json"`
Expected: a file of a few hundred KB.

- [ ] **Step 3: Write the failing tests**

`tests/test_gender.py`:
```python
from scenesearch.screenplay.gender import (
    gender_from_table,
    pairing_from_genders,
    guess_gender,
    scene_pairing,
)

TABLE = {"john": "male", "mary": "female"}


def test_gender_from_table_known():
    assert gender_from_table("JOHN", TABLE) == "male"
    assert gender_from_table("Mary", TABLE) == "female"


def test_gender_from_table_uses_first_name_only():
    assert gender_from_table("JOHN SMITH", TABLE) == "male"


def test_gender_from_table_unknown():
    assert gender_from_table("ZXQW", TABLE) == "unknown"
    assert gender_from_table("", TABLE) == "unknown"


def test_pairing_from_genders():
    assert pairing_from_genders(["male", "female"]) == "MW"
    assert pairing_from_genders(["female", "male"]) == "MW"
    assert pairing_from_genders(["male", "male"]) == "MM"
    assert pairing_from_genders(["female", "female"]) == "WW"
    assert pairing_from_genders(["male", "unknown"]) == "has_unknown"
    assert pairing_from_genders(["male"]) is None
    assert pairing_from_genders(["male", "female", "male"]) is None


def test_bundled_table_classifies_common_names():
    assert guess_gender("John") == "male"
    assert guess_gender("Mary") == "female"
    assert guess_gender("Zxqwlmn") == "unknown"


def test_scene_pairing_uses_bundled_table():
    assert scene_pairing(["JOHN", "MARY"]) == "MW"
    assert scene_pairing(["JOHN", "JOHN"]) == "MM"
    assert scene_pairing(["JOHN"]) is None
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_gender.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.screenplay.gender'`.

- [ ] **Step 5: Write minimal implementation**

`scenesearch/screenplay/gender.py`:
```python
from __future__ import annotations

import json
from pathlib import Path

_TABLE: dict[str, str] | None = None


def _load_table() -> dict[str, str]:
    global _TABLE
    if _TABLE is None:
        path = Path(__file__).with_name("names_gender.json")
        try:
            _TABLE = json.loads(path.read_text())
        except Exception:
            _TABLE = {}
    return _TABLE


def gender_from_table(name: str, table: dict[str, str]) -> str:
    if not name:
        return "unknown"
    first = name.split()[0].lower().strip(".,'\"")
    return table.get(first, "unknown")


def guess_gender(name: str) -> str:
    return gender_from_table(name, _load_table())


def pairing_from_genders(genders: list[str]) -> str | None:
    if len(genders) != 2:
        return None
    if "unknown" in genders:
        return "has_unknown"
    if genders == ["male", "male"]:
        return "MM"
    if genders == ["female", "female"]:
        return "WW"
    return "MW"


def scene_pairing(characters: list[str]) -> str | None:
    return pairing_from_genders([guess_gender(c) for c in characters])
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_gender.py -v`
Expected: PASS (7 passed).

- [ ] **Step 7: Bundle the json in the PyInstaller spec**

In `packaging/Scene Search.spec`, change the `Analysis` `datas=[]` line to:
```python
    datas=[(os.path.join(PROJECT_ROOT, "scenesearch", "screenplay", "names_gender.json"),
            "scenesearch/screenplay")],
```
(So the gender table ships inside the signed app.)

- [ ] **Step 8: Commit**

```bash
git add packaging/build_names_gender.py "packaging/Scene Search.spec" scenesearch/screenplay/names_gender.json scenesearch/screenplay/gender.py tests/test_gender.py
git commit -m "feat: add offline name->gender lookup with bundled SSA-derived data"
```

---

### Task 3: Paginated extraction + SQLite library index

**Files:**
- Modify: `scenesearch/extractors.py` (add `extract_paginated`)
- Create: `scenesearch/library.py`
- Test: `tests/test_library.py`

**Interfaces:**
- Consumes: `iter_candidates` (scanner), `extract_paginated`/`ExtractionError` (extractors), `parse_scenes` (parser), `scene_pairing` (gender).
- Produces: `extract_paginated(path, max_pages=400, max_chars=400_000) -> str` (PDF pages joined with `\f`; other formats plain). `SceneMatch` dataclass (`script_path`, `script_name`, `heading`, `page`, `char_count`, `characters: list[str]`, `pairing: str | None`). `Library(db_path)` with `reindex(folder, progress=None)`, `query(min_chars=None, max_chars=None, pairing=None) -> list[SceneMatch]`, `script_count()`, `scene_count()`, `is_indexed()`, `close()`.

- [ ] **Step 1: Add `extract_paginated` to extractors**

Append to `scenesearch/extractors.py`:
```python
def extract_paginated(path, max_pages: int = 400, max_chars: int = 400_000) -> str:
    """Like extract_text but joins PDF pages with form-feed (\\f) so scene
    page numbers can be recovered. Non-PDF formats return plain text."""
    p = Path(path)
    if p.suffix.lower() != ".pdf":
        return extract_text(p, max_chars=max_chars, pdf_max_pages=max_pages)
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(p))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:
                raise ExtractionError(p, "encrypted PDF") from exc
        parts: list[str] = []
        for page in reader.pages[:max_pages]:
            parts.append(page.extract_text() or "")
            if sum(len(x) for x in parts) >= max_chars:
                break
        return "\f".join(parts)[:max_chars]
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(p, str(exc)) from exc
```

- [ ] **Step 2: Write the failing tests**

`tests/test_library.py`:
```python
from scenesearch.library import Library
from scenesearch.extractors import extract_paginated

SCRIPT = """\
INT. DINER - DAY

NEIL
Coffee.

EADY
Sure.

EXT. STREET - NIGHT

VINCENT
Anybody there?
"""


def test_extract_paginated_plaintext(tmp_path):
    f = tmp_path / "a.fountain"
    f.write_text(SCRIPT)
    assert "INT. DINER" in extract_paginated(f)


def test_reindex_counts_scripts_and_scenes(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    assert lib.script_count() == 1
    assert lib.scene_count() == 2
    assert lib.is_indexed() is True


def test_query_by_char_count(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    two = lib.query(min_chars=2, max_chars=2)
    assert [m.heading for m in two] == ["INT. DINER - DAY"]
    assert two[0].characters == ["NEIL", "EADY"]
    assert two[0].script_name == "a.fountain"


def test_reindex_is_incremental(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    lib.reindex(tmp_path)  # unchanged -> no duplication
    assert lib.scene_count() == 2


def test_reindex_drops_deleted_files(tmp_path):
    f = tmp_path / "a.fountain"
    f.write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    f.unlink()
    lib.reindex(tmp_path)
    assert lib.script_count() == 0
    assert lib.scene_count() == 0
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_library.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.library'`.

- [ ] **Step 4: Write minimal implementation**

`scenesearch/library.py`:
```python
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from .extractors import ExtractionError, extract_paginated
from .scanner import iter_candidates
from .screenplay.gender import scene_pairing
from .screenplay.parser import parse_scenes

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scripts(
    path TEXT PRIMARY KEY, name TEXT, mtime REAL, scene_count INTEGER);
CREATE TABLE IF NOT EXISTS scenes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    script_path TEXT, scene_index INTEGER, heading TEXT, page INTEGER,
    char_count INTEGER, characters_json TEXT, pairing TEXT);
CREATE INDEX IF NOT EXISTS idx_scenes_script ON scenes(script_path);
"""


@dataclass
class SceneMatch:
    script_path: str
    script_name: str
    heading: str
    page: int
    char_count: int
    characters: list[str] = field(default_factory=list)
    pairing: str | None = None


class Library:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        self._conn.close()

    def reindex(self, folder, progress=None) -> None:
        present: set[str] = set()
        for path in iter_candidates([folder]):
            present.add(str(path.resolve()))
            self._index_file(path, progress)
        for (stored,) in self._conn.execute("SELECT path FROM scripts").fetchall():
            if stored not in present:
                self._delete_script(stored)
        self._conn.commit()

    def _index_file(self, path, progress) -> None:
        rp = str(path.resolve())
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return
        row = self._conn.execute("SELECT mtime FROM scripts WHERE path=?", (rp,)).fetchone()
        if row and abs(row[0] - mtime) < 1e-6:
            return
        try:
            text = extract_paginated(path)
        except ExtractionError:
            text = ""
        scenes = parse_scenes(text)
        self._delete_script(rp)
        self._conn.execute(
            "INSERT INTO scripts(path, name, mtime, scene_count) VALUES(?,?,?,?)",
            (rp, path.name, mtime, len(scenes)),
        )
        for s in scenes:
            self._conn.execute(
                "INSERT INTO scenes(script_path, scene_index, heading, page, "
                "char_count, characters_json, pairing) VALUES(?,?,?,?,?,?,?)",
                (rp, s.index, s.heading, s.page, len(s.characters),
                 json.dumps(s.characters), scene_pairing(s.characters)),
            )
        if progress:
            progress(path.name)

    def _delete_script(self, rp: str) -> None:
        self._conn.execute("DELETE FROM scenes WHERE script_path=?", (rp,))
        self._conn.execute("DELETE FROM scripts WHERE path=?", (rp,))

    def script_count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM scripts").fetchone()[0]

    def scene_count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM scenes").fetchone()[0]

    def is_indexed(self) -> bool:
        return self.script_count() > 0

    def query(self, min_chars=None, max_chars=None, pairing=None) -> list[SceneMatch]:
        sql = (
            "SELECT sc.path, sc.name, s.heading, s.page, s.char_count, "
            "s.characters_json, s.pairing FROM scenes s "
            "JOIN scripts sc ON sc.path = s.script_path WHERE 1=1"
        )
        args: list = []
        if min_chars is not None:
            sql += " AND s.char_count >= ?"
            args.append(min_chars)
        if max_chars is not None:
            sql += " AND s.char_count <= ?"
            args.append(max_chars)
        if pairing is not None:
            sql += " AND s.pairing = ?"
            args.append(pairing)
        sql += " ORDER BY sc.name, s.scene_index"
        out: list[SceneMatch] = []
        for path, name, heading, page, cc, cj, pr in self._conn.execute(sql, args):
            out.append(SceneMatch(path, name, heading, page, cc, json.loads(cj), pr))
        return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_library.py -v`
Expected: PASS (5 passed).

- [ ] **Step 6: Commit**

```bash
git add scenesearch/extractors.py scenesearch/library.py tests/test_library.py
git commit -m "feat: add paginated extraction and SQLite library index"
```

---

### Task 4: Filter model (scene rows / script rows)

**Files:**
- Create: `scenesearch/finder.py`
- Test: `tests/test_finder.py`

**Interfaces:**
- Consumes: `Library`, `SceneMatch` (Task 3).
- Produces: `FilterSpec` dataclass (`min_chars: int | None = None`, `max_chars: int | None = None`, `pairing: str | None = None`); `ScriptMatch` dataclass (`script_path: str`, `script_name: str`, `match_count: int`); `scene_rows(library, spec) -> list[SceneMatch]`; `script_rows(library, spec) -> list[ScriptMatch]` (matching scenes grouped by script, preserving first-seen order).

- [ ] **Step 1: Write the failing tests**

`tests/test_finder.py`:
```python
from scenesearch.library import Library
from scenesearch.finder import FilterSpec, scene_rows, script_rows

SCRIPT = """\
INT. DINER - DAY

NEIL
Coffee.

EADY
Sure.

EXT. STREET - NIGHT

VINCENT
Anybody there?
"""


def _lib(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    return lib


def test_scene_rows_all(tmp_path):
    rows = scene_rows(_lib(tmp_path), FilterSpec(min_chars=1))
    assert [r.heading for r in rows] == ["INT. DINER - DAY", "EXT. STREET - NIGHT"]


def test_scene_rows_two_handers(tmp_path):
    rows = scene_rows(_lib(tmp_path), FilterSpec(min_chars=2, max_chars=2))
    assert [r.heading for r in rows] == ["INT. DINER - DAY"]


def test_script_rows_grouping(tmp_path):
    rows = script_rows(_lib(tmp_path), FilterSpec(min_chars=1))
    assert len(rows) == 1
    assert rows[0].script_name == "a.fountain"
    assert rows[0].match_count == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_finder.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.finder'`.

- [ ] **Step 3: Write minimal implementation**

`scenesearch/finder.py`:
```python
from __future__ import annotations

from dataclasses import dataclass

from .library import Library, SceneMatch


@dataclass
class FilterSpec:
    min_chars: int | None = None
    max_chars: int | None = None
    pairing: str | None = None


@dataclass
class ScriptMatch:
    script_path: str
    script_name: str
    match_count: int


def scene_rows(library: Library, spec: FilterSpec) -> list[SceneMatch]:
    return library.query(spec.min_chars, spec.max_chars, spec.pairing)


def script_rows(library: Library, spec: FilterSpec) -> list[ScriptMatch]:
    names: dict[str, str] = {}
    counts: dict[str, int] = {}
    order: list[str] = []
    for m in scene_rows(library, spec):
        if m.script_path not in counts:
            order.append(m.script_path)
            counts[m.script_path] = 0
            names[m.script_path] = m.script_name
        counts[m.script_path] += 1
    return [ScriptMatch(p, names[p], counts[p]) for p in order]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_finder.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/finder.py tests/test_finder.py
git commit -m "feat: add Finder filter model (scene rows / script rows)"
```

---

### Task 5: Library path in Settings

**Files:**
- Modify: `scenesearch/settings.py`
- Test: `tests/test_settings.py` (add cases)

**Interfaces:**
- Consumes: existing `Settings`.
- Produces: `Settings.get_library() -> str | None`; `Settings.set_library(path) -> None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_settings.py`:
```python
def test_unset_library_is_none(tmp_path):
    assert Settings(tmp_path / "s.json").get_library() is None


def test_library_round_trip(tmp_path):
    p = tmp_path / "s.json"
    Settings(p).set_library("/Users/x/Scripts")
    assert Settings(p).get_library() == "/Users/x/Scripts"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_settings.py -k library -v`
Expected: FAIL with `AttributeError: 'Settings' object has no attribute 'get_library'`.

- [ ] **Step 3: Write minimal implementation**

In `scenesearch/settings.py`, add these methods to the `Settings` class (after `set_ignored`):
```python
    def get_library(self) -> str | None:
        value = self._data.get("library")
        return str(value) if isinstance(value, str) else None

    def set_library(self, path) -> None:
        self._data["library"] = str(path)
        self.save()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_settings.py -v`
Expected: PASS (all settings tests).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/settings.py tests/test_settings.py
git commit -m "feat: persist Finder library folder in settings"
```

---

### Task 6: Refactor search UI into SearchTab + QTabWidget shell

**Files:**
- Create: `scenesearch/ui/search_tab.py` (moved from `main_window.py`)
- Rewrite: `scenesearch/ui/main_window.py` (now a tab shell)

**Interfaces:**
- Consumes: existing search behavior; `Settings`, `ScoreCache`.
- Produces: `SearchTab(QWidget)` with the same widgets/behavior as today's `MainWindow`, taking `(settings: Settings, cache: ScoreCache)`. `MainWindow(QMainWindow)` hosting a `QTabWidget` whose first tab is `SearchTab`; keeps injectable `settings_path`/`cache_path`/`index_path`.

This is a mechanical move. Do it precisely:

- [ ] **Step 1: Copy the file**

```bash
git mv scenesearch/ui/main_window.py scenesearch/ui/search_tab.py
```

- [ ] **Step 2: Convert the class to a widget**

In `scenesearch/ui/search_tab.py`:
1. Change the imports line `from PySide6.QtWidgets import (` block: replace `QMainWindow,` with `QWidget,` (QWidget is already imported; just remove `QMainWindow`).
2. Change the class declaration `class MainWindow(QMainWindow):` to `class SearchTab(QWidget):`.
3. Change the constructor signature and head:
   - From:
     ```python
     def __init__(self, settings_path=None, cache_path=None):
         super().__init__()
         self.setWindowTitle("Scene Search")
         self.resize(1000, 640)

         self._settings = Settings(settings_path or Path.home() / ".scenesearch_settings.json")
         self._cache = ScoreCache(cache_path or Path.home() / ".scenesearch_cache.json")
     ```
   - To:
     ```python
     def __init__(self, settings, cache):
         super().__init__()
         self._settings = settings
         self._cache = cache
     ```
4. In `_build_ui`, change the central-widget setup:
   - From:
     ```python
     central = QWidget()
     self.setCentralWidget(central)
     layout = QVBoxLayout(central)
     ```
   - To:
     ```python
     layout = QVBoxLayout(self)
     ```
5. Remove the `closeEvent` method entirely (persistence already happens on every add/remove/clear; the shell handles save-on-close in Step 3).

- [ ] **Step 3: Write the new shell**

`scenesearch/ui/main_window.py`:
```python
from __future__ import annotations

from pathlib import Path

from PySide6.QtWidgets import QMainWindow, QTabWidget

from ..cache import ScoreCache
from ..settings import Settings
from .search_tab import SearchTab


class MainWindow(QMainWindow):
    def __init__(self, settings_path=None, cache_path=None, index_path=None):
        super().__init__()
        self.setWindowTitle("Scene Search")
        self.resize(1000, 700)

        self._settings = Settings(settings_path or Path.home() / ".scenesearch_settings.json")
        self._cache = ScoreCache(cache_path or Path.home() / ".scenesearch_cache.json")
        self._index_path = index_path or Path.home() / ".scenesearch_index.db"

        self.tabs = QTabWidget()
        self.setCentralWidget(self.tabs)

        self.search_tab = SearchTab(self._settings, self._cache)
        self.tabs.addTab(self.search_tab, "Search")

    def closeEvent(self, event) -> None:  # noqa: N802 (Qt override)
        self.search_tab._persist_roots()
        self.search_tab._persist_ignored()
        super().closeEvent(event)
```

- [ ] **Step 4: Verify tests and app still work**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS (all existing tests green).

Run: `QT_QPA_PLATFORM=offscreen .venv/bin/python -c "
from PySide6.QtWidgets import QApplication
import sys
app = QApplication(sys.argv)
from scenesearch.ui.main_window import MainWindow
w = MainWindow()
print('tabs:', w.tabs.count(), w.tabs.tabText(0))
print('search roots:', w.search_tab.roots_list.count())
print('ok')
"`
Expected: prints `tabs: 1 Search`, a roots count, and `ok`.

- [ ] **Step 5: Commit**

```bash
git add scenesearch/ui/search_tab.py scenesearch/ui/main_window.py
git commit -m "refactor: split search UI into SearchTab under a QTabWidget shell"
```

---

### Task 7: Finder tab UI

**Files:**
- Create: `scenesearch/ui/finder_tab.py`
- Modify: `scenesearch/ui/main_window.py` (add the second tab)
- Modify: `README.md`

**Interfaces:**
- Consumes: `Library` (Task 3), `finder.FilterSpec`/`scene_rows`/`script_rows` (Task 4), `Settings.get_library`/`set_library` (Task 5), `fileops.open_external`.
- Produces: `FinderTab(QWidget)` taking `(settings, index_path)`.

- [ ] **Step 1: Write the Finder tab**

`scenesearch/ui/finder_tab.py`:
```python
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItem, QStandardItemModel
from PySide6.QtWidgets import (
    QAbstractItemView,
    QButtonGroup,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMessageBox,
    QPushButton,
    QRadioButton,
    QSpinBox,
    QTableView,
    QVBoxLayout,
    QWidget,
)

from ..finder import FilterSpec, scene_rows, script_rows
from ..library import Library
from .. import fileops

_PAIRINGS = [
    ("Any", None),
    ("Man + Woman", "MW"),
    ("Man + Man", "MM"),
    ("Woman + Woman", "WW"),
    ("Has unknown gender", "has_unknown"),
]
_PATH_ROLE = Qt.UserRole + 1


class FinderTab(QWidget):
    def __init__(self, settings, index_path):
        super().__init__()
        self._settings = settings
        self._library = Library(index_path)
        self._build_ui()
        saved = self._settings.get_library()
        if saved:
            self.library_label.setText(saved)
        self._refresh_status()
        self._run_filter()

    # ---------- UI ----------
    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)

        lib_row = QHBoxLayout()
        self.library_label = QLabel("(no library folder chosen)")
        choose_btn = QPushButton("Choose Library Folder…")
        choose_btn.clicked.connect(self._choose_library)
        self.index_btn = QPushButton("Index")
        self.index_btn.clicked.connect(self._do_index)
        lib_row.addWidget(QLabel("Library:"))
        lib_row.addWidget(self.library_label, 1)
        lib_row.addWidget(choose_btn)
        lib_row.addWidget(self.index_btn)
        layout.addLayout(lib_row)

        self.status = QLabel("")
        layout.addWidget(self.status)

        filt = QHBoxLayout()
        filt.addWidget(QLabel("Speaking characters in scene:"))
        self.min_spin = QSpinBox()
        self.min_spin.setRange(0, 50)
        self.min_spin.setValue(2)
        self.max_spin = QSpinBox()
        self.max_spin.setRange(0, 50)
        self.max_spin.setValue(2)
        filt.addWidget(QLabel("min"))
        filt.addWidget(self.min_spin)
        filt.addWidget(QLabel("max"))
        filt.addWidget(self.max_spin)
        filt.addSpacing(16)
        filt.addWidget(QLabel("Gender pairing:"))
        self.pairing_combo = QComboBox()
        for label, _code in _PAIRINGS:
            self.pairing_combo.addItem(label)
        filt.addWidget(self.pairing_combo)
        filt.addStretch(1)
        layout.addLayout(filt)

        view_row = QHBoxLayout()
        self.scenes_radio = QRadioButton("Scenes")
        self.scripts_radio = QRadioButton("Scripts")
        self.scenes_radio.setChecked(True)
        group = QButtonGroup(self)
        group.addButton(self.scenes_radio)
        group.addButton(self.scripts_radio)
        view_row.addWidget(QLabel("Show:"))
        view_row.addWidget(self.scenes_radio)
        view_row.addWidget(self.scripts_radio)
        view_row.addStretch(1)
        layout.addLayout(view_row)

        self.model = QStandardItemModel()
        self.table = QTableView()
        self.table.setModel(self.model)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.verticalHeader().setVisible(False)
        self.table.doubleClicked.connect(self._open_selected)
        layout.addWidget(self.table, 1)

        # Re-run filter on any control change.
        self.min_spin.valueChanged.connect(self._run_filter)
        self.max_spin.valueChanged.connect(self._run_filter)
        self.pairing_combo.currentIndexChanged.connect(self._run_filter)
        self.scenes_radio.toggled.connect(self._run_filter)

    # ---------- Library actions ----------
    def _choose_library(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Choose your script library folder")
        if folder:
            self.library_label.setText(folder)
            self._settings.set_library(folder)

    def _do_index(self) -> None:
        folder = self.library_label.text()
        if not folder or folder.startswith("("):
            QMessageBox.warning(self, "No library", "Choose a library folder first.")
            return
        self.index_btn.setEnabled(False)
        self.status.setText("Indexing…")
        try:
            self._library.reindex(folder)
        except Exception as exc:
            QMessageBox.critical(self, "Indexing failed", str(exc))
        self.index_btn.setEnabled(True)
        self._refresh_status()
        self._run_filter()

    def _refresh_status(self) -> None:
        if self._library.is_indexed():
            self.status.setText(
                f"Indexed: {self._library.script_count()} scripts, "
                f"{self._library.scene_count()} scenes."
            )
        else:
            self.status.setText("Not indexed yet — choose a folder and click Index.")

    # ---------- Filtering ----------
    def _spec(self) -> FilterSpec:
        pairing = _PAIRINGS[self.pairing_combo.currentIndex()][1]
        return FilterSpec(
            min_chars=self.min_spin.value(),
            max_chars=self.max_spin.value(),
            pairing=pairing,
        )

    def _run_filter(self) -> None:
        if self.scenes_radio.isChecked():
            self._show_scenes(scene_rows(self._library, self._spec()))
        else:
            self._show_scripts(script_rows(self._library, self._spec()))

    def _show_scenes(self, rows) -> None:
        self.model.clear()
        self.model.setHorizontalHeaderLabels(
            ["Script", "Scene", "Page", "# Chars", "Characters", "Pairing"]
        )
        pretty = {None: "", "MW": "M+W", "MM": "M+M", "WW": "W+W", "has_unknown": "?"}
        for m in rows:
            items = [
                self._cell(m.script_name, m.script_path),
                self._cell(m.heading),
                self._cell(str(m.page) if m.page else "—"),
                self._cell(str(m.char_count)),
                self._cell(", ".join(m.characters)),
                self._cell(pretty.get(m.pairing, "")),
            ]
            self.model.appendRow(items)
        self._fit()

    def _show_scripts(self, rows) -> None:
        self.model.clear()
        self.model.setHorizontalHeaderLabels(["Script", "Matching scenes"])
        for m in rows:
            self.model.appendRow(
                [self._cell(m.script_name, m.script_path), self._cell(str(m.match_count))]
            )
        self._fit()

    @staticmethod
    def _cell(text, path=None) -> QStandardItem:
        item = QStandardItem(text)
        item.setEditable(False)
        if path is not None:
            item.setData(path, _PATH_ROLE)
        return item

    def _fit(self) -> None:
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)

    def _open_selected(self, index) -> None:
        row = index.row()
        path_item = self.model.item(row, 0)
        if path_item is not None:
            path = path_item.data(_PATH_ROLE)
            if path:
                fileops.open_external(path)
```

- [ ] **Step 2: Add the tab to the shell**

In `scenesearch/ui/main_window.py`:
1. Add import: `from .finder_tab import FinderTab`.
2. After the `self.tabs.addTab(self.search_tab, "Search")` line, add:
```python
        self.finder_tab = FinderTab(self._settings, self._index_path)
        self.tabs.addTab(self.finder_tab, "Finder")
```

- [ ] **Step 3: Verify it constructs and runs offscreen**

Run:
```bash
QT_QPA_PLATFORM=offscreen .venv/bin/python -c "
import sys, tempfile, pathlib
from PySide6.QtWidgets import QApplication
app = QApplication(sys.argv)
from scenesearch.ui.main_window import MainWindow
d = pathlib.Path(tempfile.mkdtemp())
mw = MainWindow(settings_path=d/'s.json', cache_path=d/'c.json', index_path=d/'i.db')
print('tabs:', [mw.tabs.tabText(i) for i in range(mw.tabs.count())])
# index a tiny library and filter
lib_dir = d/'lib'; lib_dir.mkdir()
(lib_dir/'x.fountain').write_text('INT. ROOM - DAY\n\nBOB\nHi.\n\nSUE\nHey.\n')
ft = mw.finder_tab
ft.library_label.setText(str(lib_dir))
ft._do_index()
ft.scenes_radio.setChecked(True); ft._run_filter()
print('scene rows:', ft.model.rowCount(), 'status:', ft.status.text())
print('ok')
" 2>/dev/null
```
Expected: prints `tabs: ['Search', 'Finder']`, `scene rows: 1 ...`, `ok`.

- [ ] **Step 4: Launch the app and verify by hand**

Run: `.venv/bin/python app.py`

Verify:
1. Two tabs appear: **Search** and **Finder**.
2. On **Finder**: click **Choose Library Folder…**, pick a folder with scripts, click **Index** — status shows "Indexed: N scripts, M scenes."
3. Set min/max characters to 2 → results show two-character scenes.
4. Change **Gender pairing** to "Man + Woman" → list narrows.
5. Flip **Scenes / Scripts** → the table switches between per-scene and per-script views.
6. Double-click a row → the script opens in the default app.

- [ ] **Step 5: Update the README**

Append to `README.md`:
```markdown
## Finder tab

The **Finder** tab turns one folder into a searchable script *library*. Choose
the folder and click **Index** once (it parses every script into a local
database; re-indexing only re-reads changed files). Then filter offline by:

- **# speaking characters in a scene** (set min and max to 2 for two-handers)
- **Gender pairing** of two-character scenes (M+W, M+M, W+W, or "has unknown")

Toggle between **Scenes** (every matching scene) and **Scripts** (which scripts
qualify, with a count). Double-click a result to open the script.

Gender is inferred offline from first names and is approximate — unrecognized
names (unisex, invented, or non-English) fall into an "unknown" bucket.
```

- [ ] **Step 6: Run the full suite and commit**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS (all tests green).

```bash
git add scenesearch/ui/finder_tab.py scenesearch/ui/main_window.py README.md
git commit -m "feat: add Finder tab UI (library index + scene/character/gender filters)"
```

---

## Self-Review

**Spec coverage:**
- Two-tab layout / SearchTab refactor / QTabWidget shell → Task 6. ✓
- Offline scene+character parser → Task 1. ✓
- Bundled offline name→gender + pairing → Task 2. ✓
- SQLite library index (incremental, deletion, query) → Task 3. ✓
- Paginated extraction for page numbers → Task 3. ✓
- Filter model with Scenes/Scripts grouping → Task 4. ✓
- Library folder persisted in Settings → Task 5. ✓
- Finder UI: choose folder, Index + status, min/max chars, pairing dropdown, Scenes⇄Scripts toggle, double-click open → Task 7. ✓
- names_gender.json bundled into the signed app → Task 2 Step 7. ✓
- README → Task 7 Step 5. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; the Task 6 refactor uses explicit before/after edits, not "similar to."

**Type consistency:** `Scene(heading,index,page,characters)` produced in Task 1, consumed in Task 3. `SceneMatch(script_path,script_name,heading,page,char_count,characters,pairing)` defined in Task 3, used in Tasks 4/7. `FilterSpec(min_chars,max_chars,pairing)` and `ScriptMatch(script_path,script_name,match_count)` defined in Task 4, used in Task 7. Pairing codes `MW/MM/WW/has_unknown` consistent across gender.py, library query, finder, and the UI dropdown. `scene_pairing`/`pairing_from_genders`/`gender_from_table`/`guess_gender` names consistent between Tasks 2 and 3. `Library(db_path)`, `.reindex`, `.query`, `.script_count`, `.scene_count`, `.is_indexed` consistent across Tasks 3/4/7. `Settings.get_library/set_library` consistent Tasks 5/7.
