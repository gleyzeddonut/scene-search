# Scene Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native macOS desktop app that finds movie scripts on the filesystem, confirms them by reading inside the files, lists them, and lets the user copy/move/rename/open/delete them.

**Architecture:** A GUI-free, fully unit-tested core (scanner → extractors → classifier → pipeline, plus cache, model, and fileops) wrapped by a thin PySide6 (Qt) UI. The scan runs on a background `QThread` that streams results into a sortable table so the window never freezes.

**Tech Stack:** Python 3, PySide6 (Qt), pypdf, python-docx, Send2Trash, pytest.

## Global Constraints

- Platform: macOS only. Native window (NOT browser-based).
- Run command: `python3 app.py` (from inside the project's venv).
- Script file types detected: `.pdf .fountain .fdx .txt .docx` (exact set).
- Default scan folders: `~/Downloads`, `~/Desktop`, `~/Documents`, and `~/Library/Mobile Documents/com~apple~CloudDocs/Documents` (iCloud Drive Documents). Plus any user-added folders.
- Detection confirms by content (screenplay cues), not by extension alone.
- Delete is always move-to-Trash via `send2trash` — NEVER permanent deletion.
- Core modules under `scenesearch/` must not import PySide6 (keeps them testable headless). Only `scenesearch/ui/` and `app.py` import PySide6.
- Confidence threshold default: `0.35` (defined once as `DEFAULT_THRESHOLD` in `classifier.py`).
- OCR of scanned/image PDFs is out of scope.

---

### Task 1: Project scaffold, environment, and dependencies

**Files:**
- Create: `requirements.txt`
- Create: `scenesearch/__init__.py`
- Create: `scenesearch/ui/__init__.py`
- Create: `tests/__init__.py`
- Create: `pytest.ini`

**Interfaces:**
- Consumes: nothing.
- Produces: a working venv at `.venv/` with all deps importable; the `scenesearch` package importable; `pytest` runnable.

- [ ] **Step 1: Create `requirements.txt`**

```
PySide6>=6.7
pypdf>=4.0
python-docx>=1.1
Send2Trash>=1.8
pytest>=8.0
```

- [ ] **Step 2: Create the package skeleton files**

`scenesearch/__init__.py`:
```python
"""Scene Search — find and manage movie scripts on disk."""
```

`scenesearch/ui/__init__.py`:
```python
"""Qt UI layer for Scene Search."""
```

`tests/__init__.py`:
```python
```

`pytest.ini`:
```ini
[pytest]
testpaths = tests
python_files = test_*.py
```

- [ ] **Step 3: Create the venv and install dependencies**

Run:
```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
```

Expected: all packages install successfully.

> **Contingency:** PySide6 may not yet publish wheels for Python 3.14. If `pip install` fails on PySide6, create the venv with an older interpreter instead, e.g. `brew install python@3.12` then `/opt/homebrew/bin/python3.12 -m venv .venv`, and re-run the install. The rest of the plan is unaffected — just use `.venv/bin/python` throughout.

- [ ] **Step 4: Verify all imports work**

Run:
```bash
.venv/bin/python -c "import PySide6, pypdf, docx, send2trash; print('ok')"
```
Expected: prints `ok`.

- [ ] **Step 5: Verify pytest runs (no tests yet)**

Run: `.venv/bin/python -m pytest`
Expected: exits cleanly with "no tests ran".

- [ ] **Step 6: Commit**

```bash
git add requirements.txt pytest.ini scenesearch tests
git commit -m "chore: project scaffold, venv, and dependencies"
```

---

### Task 2: `ScriptEntry` data model

**Files:**
- Create: `scenesearch/model.py`
- Test: `tests/test_model.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ScriptEntry` frozen dataclass with fields `path: Path`, `name: str`, `folder: Path`, `file_type: str`, `size_bytes: int`, `modified: datetime`, `confidence: float`, `matched_cues: list[str]`; and classmethod `ScriptEntry.from_path(path, confidence: float, matched_cues: list[str]) -> ScriptEntry`.

- [ ] **Step 1: Write the failing test**

`tests/test_model.py`:
```python
from datetime import datetime
from pathlib import Path

from scenesearch.model import ScriptEntry


def test_from_path_fills_metadata(tmp_path):
    f = tmp_path / "Chinatown.pdf"
    f.write_text("dummy")

    entry = ScriptEntry.from_path(f, confidence=0.9, matched_cues=["3 scene heading(s)"])

    assert entry.path == f
    assert entry.name == "Chinatown.pdf"
    assert entry.folder == tmp_path
    assert entry.file_type == "pdf"
    assert entry.size_bytes == len("dummy")
    assert isinstance(entry.modified, datetime)
    assert entry.confidence == 0.9
    assert entry.matched_cues == ["3 scene heading(s)"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_model.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.model'`.

- [ ] **Step 3: Write minimal implementation**

`scenesearch/model.py`:
```python
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class ScriptEntry:
    path: Path
    name: str
    folder: Path
    file_type: str
    size_bytes: int
    modified: datetime
    confidence: float
    matched_cues: list[str] = field(default_factory=list)

    @classmethod
    def from_path(cls, path, confidence: float, matched_cues: list[str]) -> "ScriptEntry":
        p = Path(path)
        st = p.stat()
        return cls(
            path=p,
            name=p.name,
            folder=p.parent,
            file_type=p.suffix.lower().lstrip("."),
            size_bytes=st.st_size,
            modified=datetime.fromtimestamp(st.st_mtime),
            confidence=confidence,
            matched_cues=list(matched_cues),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_model.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scenesearch/model.py tests/test_model.py
git commit -m "feat: add ScriptEntry data model"
```

---

### Task 3: Screenplay classifier

**Files:**
- Create: `scenesearch/classifier.py`
- Test: `tests/test_classifier.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_THRESHOLD: float = 0.35` and `score(text: str) -> tuple[float, list[str]]` returning `(confidence, matched_cues)` where confidence is `0.0`–`1.0`.

- [ ] **Step 1: Write the failing tests**

`tests/test_classifier.py`:
```python
from scenesearch.classifier import score, DEFAULT_THRESHOLD

SCRIPT = """\
INT. COFFEE SHOP - DAY

JOHN sits alone, staring at his cup.

JOHN
I can't believe it's over.

EXT. CITY STREET - NIGHT

She walks away.

FADE OUT.
"""

ARTICLE = """\
The quarterly earnings report showed a modest increase in revenue.
Analysts had expected stronger growth, but supply constraints weighed
on the consumer electronics segment throughout the period.
"""


def test_real_screenplay_scores_high():
    confidence, cues = score(SCRIPT)
    assert confidence >= 0.7
    assert confidence > DEFAULT_THRESHOLD
    assert any("scene heading" in c for c in cues)


def test_non_script_scores_below_threshold():
    confidence, cues = score(ARTICLE)
    assert confidence < DEFAULT_THRESHOLD


def test_empty_text_scores_zero():
    assert score("") == (0.0, [])
    assert score("   \n  ") == (0.0, [])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_classifier.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.classifier'`.

- [ ] **Step 3: Write minimal implementation**

`scenesearch/classifier.py`:
```python
from __future__ import annotations

import re

DEFAULT_THRESHOLD = 0.35

_SCENE_RE = re.compile(
    r"^\s*(INT\.?/EXT\.?|EXT\.?/INT\.?|INT|EXT|I/E|E/I)[\.\s]",
    re.IGNORECASE | re.MULTILINE,
)
_TRANSITION_RE = re.compile(
    r"\b(FADE IN|FADE OUT|FADE TO BLACK|CUT TO|SMASH CUT|MATCH CUT|DISSOLVE TO)\b"
)
_TITLE_RE = re.compile(
    r"\b(written by|screenplay by|story by|teleplay by)\b", re.IGNORECASE
)
_CHAR_CUE_RE = re.compile(r"^[ \t]*[A-Z][A-Z0-9 .'\-]{1,30}(\([A-Z. ]+\))?[ \t]*$")


def _count_character_cues(text: str) -> int:
    count = 0
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if _SCENE_RE.match(line):
            continue
        if _TRANSITION_RE.search(stripped):
            continue
        if not _CHAR_CUE_RE.match(line):
            continue
        words = stripped.split()
        if 1 <= len(words) <= 4 and any(c.isalpha() for c in stripped):
            count += 1
    return count


def score(text: str) -> tuple[float, list[str]]:
    if not text or not text.strip():
        return 0.0, []

    scene = len(_SCENE_RE.findall(text))
    trans = len(_TRANSITION_RE.findall(text))
    title = len(_TITLE_RE.findall(text))
    cues_n = _count_character_cues(text)

    raw = (
        min(scene, 5) * 3
        + min(trans, 3) * 2
        + min(cues_n, 6) * 0.5
        + min(title, 2) * 2
    )
    confidence = min(raw / 10.0, 1.0)

    matched: list[str] = []
    if scene:
        matched.append(f"{scene} scene heading(s) (INT./EXT.)")
    if trans:
        matched.append(f"{trans} transition(s) (e.g. FADE IN / CUT TO)")
    if cues_n:
        matched.append(f"{cues_n} character cue(s)")
    if title:
        matched.append("title-page phrase (written by / screenplay by)")

    return round(confidence, 3), matched
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_classifier.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/classifier.py tests/test_classifier.py
git commit -m "feat: add screenplay content classifier"
```

---

### Task 4: Text extractors

**Files:**
- Create: `scenesearch/extractors.py`
- Test: `tests/test_extractors.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ExtractionError(Exception)` with attributes `.path: Path` and `.reason: str`; and `extract_text(path, max_chars: int = 20000, pdf_max_pages: int = 8) -> str`. Dispatches by extension: `.pdf` (pypdf), `.docx` (python-docx), `.fdx` (XML), `.txt`/`.fountain` (plain read). Raises `ExtractionError` on unsupported extension or read failure.

- [ ] **Step 1: Write the failing tests**

`tests/test_extractors.py`:
```python
import pytest

from scenesearch.extractors import extract_text, ExtractionError


def test_plaintext_fountain(tmp_path):
    f = tmp_path / "script.fountain"
    f.write_text("INT. ROOM - DAY\n\nHello.\n")
    assert "INT. ROOM" in extract_text(f)


def test_txt(tmp_path):
    f = tmp_path / "notes.txt"
    f.write_text("some plain text")
    assert extract_text(f) == "some plain text"


def test_fdx_xml(tmp_path):
    f = tmp_path / "movie.fdx"
    f.write_text(
        '<?xml version="1.0"?>'
        "<FinalDraft><Content>"
        '<Paragraph Type="Scene Heading"><Text>INT. HOUSE - DAY</Text></Paragraph>'
        '<Paragraph Type="Action"><Text>A man enters.</Text></Paragraph>'
        "</Content></FinalDraft>"
    )
    out = extract_text(f)
    assert "INT. HOUSE - DAY" in out
    assert "A man enters." in out


def test_unsupported_extension_raises(tmp_path):
    f = tmp_path / "image.jpg"
    f.write_bytes(b"\xff\xd8\xff")
    with pytest.raises(ExtractionError) as exc:
        extract_text(f)
    assert "unsupported" in exc.value.reason


def test_corrupt_pdf_raises(tmp_path):
    f = tmp_path / "broken.pdf"
    f.write_bytes(b"not a real pdf")
    with pytest.raises(ExtractionError):
        extract_text(f)


def test_max_chars_truncates(tmp_path):
    f = tmp_path / "big.txt"
    f.write_text("x" * 5000)
    assert len(extract_text(f, max_chars=100)) == 100
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_extractors.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.extractors'`.

- [ ] **Step 3: Write minimal implementation**

`scenesearch/extractors.py`:
```python
from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path


class ExtractionError(Exception):
    def __init__(self, path, reason: str):
        super().__init__(f"{path}: {reason}")
        self.path = Path(path)
        self.reason = reason


_PLAINTEXT_SUFFIXES = {".txt", ".fountain"}


def extract_text(path, max_chars: int = 20000, pdf_max_pages: int = 8) -> str:
    p = Path(path)
    suffix = p.suffix.lower()
    try:
        if suffix == ".pdf":
            return _extract_pdf(p, pdf_max_pages, max_chars)
        if suffix == ".docx":
            return _extract_docx(p, max_chars)
        if suffix == ".fdx":
            return _extract_fdx(p, max_chars)
        if suffix in _PLAINTEXT_SUFFIXES:
            return _extract_plaintext(p, max_chars)
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(p, str(exc)) from exc
    raise ExtractionError(p, f"unsupported extension '{suffix}'")


def _extract_plaintext(p: Path, max_chars: int) -> str:
    return p.read_text(encoding="utf-8", errors="ignore")[:max_chars]


def _extract_pdf(p: Path, pdf_max_pages: int, max_chars: int) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(p))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:
            raise ExtractionError(p, "encrypted PDF") from exc
    parts: list[str] = []
    for page in reader.pages[:pdf_max_pages]:
        parts.append(page.extract_text() or "")
        if sum(len(x) for x in parts) >= max_chars:
            break
    return "\n".join(parts)[:max_chars]


def _extract_docx(p: Path, max_chars: int) -> str:
    import docx

    doc = docx.Document(str(p))
    return "\n".join(par.text for par in doc.paragraphs)[:max_chars]


def _extract_fdx(p: Path, max_chars: int) -> str:
    tree = ET.parse(str(p))
    texts = [el.text for el in tree.iter("Text") if el.text]
    return "\n".join(texts)[:max_chars]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_extractors.py -v`
Expected: PASS (6 passed).

> Note: automated PDF *content* extraction is verified manually when running the app (Task 10), since generating a text-bearing PDF in a test would require an extra dependency. The corrupt-PDF test confirms the error path.

- [ ] **Step 5: Commit**

```bash
git add scenesearch/extractors.py tests/test_extractors.py
git commit -m "feat: add per-format text extractors"
```

---

### Task 5: Filesystem scanner

**Files:**
- Create: `scenesearch/scanner.py`
- Test: `tests/test_scanner.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `SCRIPT_EXTENSIONS: set[str]`; `default_roots() -> list[Path]` (only existing dirs among the four defaults); `iter_candidates(roots: Iterable) -> Iterator[Path]` yielding files whose suffix is in `SCRIPT_EXTENSIONS`, skipping hidden dirs, `node_modules`, `__pycache__`, `.git`, `Caches`, `Library`, and `*.app` bundles, de-duplicated by resolved path.

- [ ] **Step 1: Write the failing tests**

`tests/test_scanner.py`:
```python
from scenesearch.scanner import iter_candidates, SCRIPT_EXTENSIONS, default_roots


def test_finds_script_extensions_and_skips_others(tmp_path):
    (tmp_path / "a.pdf").write_text("x")
    (tmp_path / "b.fountain").write_text("x")
    (tmp_path / "c.jpg").write_text("x")
    (tmp_path / "d.txt").write_text("x")

    names = {p.name for p in iter_candidates([tmp_path])}
    assert names == {"a.pdf", "b.fountain", "d.txt"}


def test_skips_noise_directories(tmp_path):
    good = tmp_path / "Scripts"
    good.mkdir()
    (good / "real.pdf").write_text("x")

    junk = tmp_path / "node_modules"
    junk.mkdir()
    (junk / "ignored.pdf").write_text("x")

    hidden = tmp_path / ".hidden"
    hidden.mkdir()
    (hidden / "secret.pdf").write_text("x")

    names = {p.name for p in iter_candidates([tmp_path])}
    assert names == {"real.pdf"}


def test_deduplicates_overlapping_roots(tmp_path):
    (tmp_path / "x.txt").write_text("x")
    results = list(iter_candidates([tmp_path, tmp_path]))
    assert len(results) == 1


def test_default_roots_returns_only_existing_dirs():
    for root in default_roots():
        assert root.is_dir()


def test_script_extensions_exact():
    assert SCRIPT_EXTENSIONS == {".pdf", ".fountain", ".fdx", ".txt", ".docx"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_scanner.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.scanner'`.

- [ ] **Step 3: Write minimal implementation**

`scenesearch/scanner.py`:
```python
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Iterator

SCRIPT_EXTENSIONS = {".pdf", ".fountain", ".fdx", ".txt", ".docx"}
_SKIP_DIR_NAMES = {"node_modules", "__pycache__", ".git", "Caches", "Library"}


def default_roots() -> list[Path]:
    home = Path.home()
    candidates = [
        home / "Downloads",
        home / "Desktop",
        home / "Documents",
        home / "Library/Mobile Documents/com~apple~CloudDocs/Documents",
    ]
    return [c for c in candidates if c.is_dir()]


def iter_candidates(roots: Iterable) -> Iterator[Path]:
    seen: set[Path] = set()
    for root in roots:
        root = Path(root)
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d
                for d in dirnames
                if not d.startswith(".")
                and d not in _SKIP_DIR_NAMES
                and not d.endswith(".app")
            ]
            for fname in filenames:
                if fname.startswith("."):
                    continue
                fp = Path(dirpath) / fname
                if fp.suffix.lower() not in SCRIPT_EXTENSIONS:
                    continue
                rp = fp.resolve()
                if rp in seen:
                    continue
                seen.add(rp)
                yield fp
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_scanner.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/scanner.py tests/test_scanner.py
git commit -m "feat: add filesystem scanner with skip rules"
```

---

### Task 6: Score cache

**Files:**
- Create: `scenesearch/cache.py`
- Test: `tests/test_cache.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ScoreCache(path)` with `get(path, mtime: float, size: int) -> dict | None` (returns `{"confidence": float, "cues": list[str]}` or `None`), `put(path, mtime, size, confidence, cues) -> None`, `load() -> None`, `save() -> None`. Cache key is `path + mtime + size`, so a changed file misses.

- [ ] **Step 1: Write the failing tests**

`tests/test_cache.py`:
```python
from scenesearch.cache import ScoreCache


def test_put_then_get_hit(tmp_path):
    f = tmp_path / "s.pdf"
    f.write_text("x")
    cache = ScoreCache(tmp_path / "cache.json")
    st = f.stat()

    cache.put(f, st.st_mtime, st.st_size, 0.8, ["3 scene heading(s)"])
    hit = cache.get(f, st.st_mtime, st.st_size)

    assert hit == {"confidence": 0.8, "cues": ["3 scene heading(s)"]}


def test_changed_mtime_misses(tmp_path):
    f = tmp_path / "s.pdf"
    f.write_text("x")
    cache = ScoreCache(tmp_path / "cache.json")
    st = f.stat()
    cache.put(f, st.st_mtime, st.st_size, 0.8, [])

    assert cache.get(f, st.st_mtime + 10, st.st_size) is None


def test_persists_across_load(tmp_path):
    f = tmp_path / "s.pdf"
    f.write_text("x")
    st = f.stat()
    cache_path = tmp_path / "cache.json"

    c1 = ScoreCache(cache_path)
    c1.put(f, st.st_mtime, st.st_size, 0.5, ["x"])
    c1.save()

    c2 = ScoreCache(cache_path)
    assert c2.get(f, st.st_mtime, st.st_size) == {"confidence": 0.5, "cues": ["x"]}


def test_corrupt_cache_file_is_ignored(tmp_path):
    cache_path = tmp_path / "cache.json"
    cache_path.write_text("{ not valid json")
    cache = ScoreCache(cache_path)  # must not raise
    assert cache.get(tmp_path / "x.pdf", 1.0, 1) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_cache.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.cache'`.

- [ ] **Step 3: Write minimal implementation**

`scenesearch/cache.py`:
```python
from __future__ import annotations

import json
from pathlib import Path


class ScoreCache:
    def __init__(self, path):
        self.path = Path(path)
        self._data: dict[str, dict] = {}
        self.load()

    def load(self) -> None:
        if self.path.is_file():
            try:
                self._data = json.loads(self.path.read_text())
            except Exception:
                self._data = {}

    def save(self) -> None:
        self.path.write_text(json.dumps(self._data))

    @staticmethod
    def _key(path, mtime: float, size: int) -> str:
        return f"{Path(path).resolve()}|{int(mtime)}|{int(size)}"

    def get(self, path, mtime: float, size: int):
        return self._data.get(self._key(path, mtime, size))

    def put(self, path, mtime: float, size: int, confidence: float, cues) -> None:
        self._data[self._key(path, mtime, size)] = {
            "confidence": confidence,
            "cues": list(cues),
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_cache.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/cache.py tests/test_cache.py
git commit -m "feat: add mtime-keyed score cache"
```

---

### Task 7: File operations

**Files:**
- Create: `scenesearch/fileops.py`
- Test: `tests/test_fileops.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `copy_to(path, dest_dir) -> Path`, `move_to(path, dest_dir) -> Path` (both auto-suffix `" (1)"`, `" (2)"`… on name collision), `rename(path, new_name) -> Path` (raises `FileExistsError` on collision), `delete_to_trash(path) -> None` (via `send2trash`), `open_external(path) -> None` (`open`), `reveal_in_finder(path) -> None` (`open -R`).

- [ ] **Step 1: Write the failing tests**

`tests/test_fileops.py`:
```python
import pytest

from scenesearch import fileops


def test_copy_to(tmp_path):
    src = tmp_path / "a.txt"
    src.write_text("hello")
    dest_dir = tmp_path / "out"
    dest_dir.mkdir()

    result = fileops.copy_to(src, dest_dir)

    assert result == dest_dir / "a.txt"
    assert result.read_text() == "hello"
    assert src.exists()  # copy leaves original


def test_copy_to_collision_autosuffixes(tmp_path):
    src = tmp_path / "a.txt"
    src.write_text("hello")
    dest_dir = tmp_path / "out"
    dest_dir.mkdir()
    (dest_dir / "a.txt").write_text("existing")

    result = fileops.copy_to(src, dest_dir)

    assert result == dest_dir / "a (1).txt"
    assert result.read_text() == "hello"


def test_move_to(tmp_path):
    src = tmp_path / "a.txt"
    src.write_text("hello")
    dest_dir = tmp_path / "out"
    dest_dir.mkdir()

    result = fileops.move_to(src, dest_dir)

    assert result == dest_dir / "a.txt"
    assert not src.exists()


def test_rename(tmp_path):
    src = tmp_path / "old.txt"
    src.write_text("x")
    result = fileops.rename(src, "new.txt")
    assert result == tmp_path / "new.txt"
    assert result.exists()
    assert not src.exists()


def test_rename_collision_raises(tmp_path):
    src = tmp_path / "old.txt"
    src.write_text("x")
    (tmp_path / "taken.txt").write_text("y")
    with pytest.raises(FileExistsError):
        fileops.rename(src, "taken.txt")


def test_delete_to_trash_uses_send2trash(tmp_path, monkeypatch):
    called = {}
    monkeypatch.setattr(fileops, "send2trash", lambda p: called.setdefault("p", p))
    f = tmp_path / "a.txt"
    f.write_text("x")

    fileops.delete_to_trash(f)

    assert called["p"] == str(f)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_fileops.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.fileops'`.

- [ ] **Step 3: Write minimal implementation**

`scenesearch/fileops.py`:
```python
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from send2trash import send2trash


def _unique_dest(dest_dir, name: str) -> Path:
    dest_dir = Path(dest_dir)
    dest = dest_dir / name
    if not dest.exists():
        return dest
    stem, suffix = Path(name).stem, Path(name).suffix
    i = 1
    while True:
        candidate = dest_dir / f"{stem} ({i}){suffix}"
        if not candidate.exists():
            return candidate
        i += 1


def copy_to(path, dest_dir) -> Path:
    src = Path(path)
    dest = _unique_dest(dest_dir, src.name)
    shutil.copy2(src, dest)
    return dest


def move_to(path, dest_dir) -> Path:
    src = Path(path)
    dest = _unique_dest(dest_dir, src.name)
    shutil.move(str(src), str(dest))
    return dest


def rename(path, new_name: str) -> Path:
    src = Path(path)
    dest = src.with_name(new_name)
    if dest.exists():
        raise FileExistsError(f"{dest} already exists")
    src.rename(dest)
    return dest


def delete_to_trash(path) -> None:
    send2trash(str(path))


def open_external(path) -> None:
    subprocess.run(["open", str(path)], check=False)


def reveal_in_finder(path) -> None:
    subprocess.run(["open", "-R", str(path)], check=False)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_fileops.py -v`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/fileops.py tests/test_fileops.py
git commit -m "feat: add file operations (copy/move/rename/trash/open)"
```

---

### Task 8: Scan pipeline (orchestration)

**Files:**
- Create: `scenesearch/pipeline.py`
- Test: `tests/test_pipeline.py`

**Interfaces:**
- Consumes: `iter_candidates` (Task 5), `extract_text`/`ExtractionError` (Task 4), `score`/`DEFAULT_THRESHOLD` (Task 3), `ScriptEntry.from_path` (Task 2), `ScoreCache` (Task 6).
- Produces: event dataclasses `FoundEvent(entry: ScriptEntry)`, `UnreadableEvent(path: Path, reason: str)`, `ProgressEvent(scanned: int, current: Path)`; and generator `scan_for_scripts(roots, threshold: float = DEFAULT_THRESHOLD, cache: ScoreCache | None = None) -> Iterator[FoundEvent | UnreadableEvent | ProgressEvent]`.

- [ ] **Step 1: Write the failing tests**

`tests/test_pipeline.py`:
```python
from scenesearch.pipeline import (
    scan_for_scripts,
    FoundEvent,
    UnreadableEvent,
    ProgressEvent,
)

SCRIPT = """\
INT. COFFEE SHOP - DAY

JOHN
I can't believe it.

EXT. STREET - NIGHT

FADE OUT.
"""


def test_finds_real_script_and_skips_junk(tmp_path):
    (tmp_path / "real.fountain").write_text(SCRIPT)
    (tmp_path / "notes.txt").write_text("just a shopping list of groceries")

    events = list(scan_for_scripts([tmp_path]))

    found = [e for e in events if isinstance(e, FoundEvent)]
    assert len(found) == 1
    assert found[0].entry.name == "real.fountain"
    assert found[0].entry.confidence >= 0.35


def test_emits_progress_events(tmp_path):
    (tmp_path / "a.txt").write_text("x")
    events = list(scan_for_scripts([tmp_path]))
    assert any(isinstance(e, ProgressEvent) for e in events)


def test_empty_text_file_is_unreadable(tmp_path):
    (tmp_path / "blank.txt").write_text("")
    events = list(scan_for_scripts([tmp_path]))
    assert any(isinstance(e, UnreadableEvent) for e in events)


def test_cache_avoids_recompute(tmp_path):
    from scenesearch.cache import ScoreCache

    f = tmp_path / "real.fountain"
    f.write_text(SCRIPT)
    cache = ScoreCache(tmp_path / "cache.json")

    list(scan_for_scripts([tmp_path], cache=cache))
    st = f.stat()
    assert cache.get(f, st.st_mtime, st.st_size) is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.pipeline'`.

- [ ] **Step 3: Write minimal implementation**

`scenesearch/pipeline.py`:
```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .cache import ScoreCache
from .classifier import DEFAULT_THRESHOLD, score
from .extractors import ExtractionError, extract_text
from .model import ScriptEntry
from .scanner import iter_candidates


@dataclass
class FoundEvent:
    entry: ScriptEntry


@dataclass
class UnreadableEvent:
    path: Path
    reason: str


@dataclass
class ProgressEvent:
    scanned: int
    current: Path


def scan_for_scripts(
    roots,
    threshold: float = DEFAULT_THRESHOLD,
    cache: ScoreCache | None = None,
) -> Iterator[object]:
    scanned = 0
    for path in iter_candidates(roots):
        scanned += 1
        yield ProgressEvent(scanned, path)

        try:
            st = path.stat()
        except OSError as exc:
            yield UnreadableEvent(path, str(exc))
            continue

        cached = cache.get(path, st.st_mtime, st.st_size) if cache else None
        if cached is not None:
            confidence = cached["confidence"]
            cues = cached["cues"]
        else:
            try:
                text = extract_text(path)
            except ExtractionError as exc:
                yield UnreadableEvent(path, exc.reason)
                continue
            if not text.strip():
                yield UnreadableEvent(
                    path, "no extractable text (maybe a scanned image)"
                )
                continue
            confidence, cues = score(text)
            if cache is not None:
                cache.put(path, st.st_mtime, st.st_size, confidence, cues)

        if confidence >= threshold:
            yield FoundEvent(ScriptEntry.from_path(path, confidence, cues))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_pipeline.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Run the full core test suite**

Run: `.venv/bin/python -m pytest -v`
Expected: PASS (all tests from Tasks 2–8 green).

- [ ] **Step 6: Commit**

```bash
git add scenesearch/pipeline.py tests/test_pipeline.py
git commit -m "feat: add scan pipeline orchestration"
```

---

### Task 9: Background scan worker (Qt)

**Files:**
- Create: `scenesearch/ui/scan_worker.py`

**Interfaces:**
- Consumes: `scan_for_scripts`, `FoundEvent`, `UnreadableEvent`, `ProgressEvent` (Task 8); `ScriptEntry` (Task 2); `ScoreCache` (Task 6).
- Produces: `ScanWorker(QObject)` with signals `found(object)` (a `ScriptEntry`), `unreadable(str, str)` (path, reason), `progress(int, str)` (scanned, current path), `finished(int, int)` (total_found, total_unreadable); methods `run()` and `cancel()`. `run()` saves the cache before emitting `finished`.

- [ ] **Step 1: Write the implementation**

`scenesearch/ui/scan_worker.py`:
```python
from __future__ import annotations

from PySide6.QtCore import QObject, Signal

from ..pipeline import FoundEvent, ProgressEvent, UnreadableEvent, scan_for_scripts


class ScanWorker(QObject):
    found = Signal(object)         # ScriptEntry
    unreadable = Signal(str, str)  # path, reason
    progress = Signal(int, str)    # scanned, current path
    finished = Signal(int, int)    # total_found, total_unreadable

    def __init__(self, roots, threshold, cache=None):
        super().__init__()
        self._roots = roots
        self._threshold = threshold
        self._cache = cache
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    def run(self) -> None:
        found_n = 0
        unreadable_n = 0
        for event in scan_for_scripts(self._roots, self._threshold, self._cache):
            if self._cancelled:
                break
            if isinstance(event, FoundEvent):
                found_n += 1
                self.found.emit(event.entry)
            elif isinstance(event, UnreadableEvent):
                unreadable_n += 1
                self.unreadable.emit(str(event.path), event.reason)
            elif isinstance(event, ProgressEvent):
                self.progress.emit(event.scanned, str(event.current))
        if self._cache is not None:
            self._cache.save()
        self.finished.emit(found_n, unreadable_n)
```

- [ ] **Step 2: Smoke-test the worker headlessly (no GUI event loop)**

Run:
```bash
.venv/bin/python -c "
from scenesearch.ui.scan_worker import ScanWorker
import tempfile, pathlib
d = tempfile.mkdtemp()
pathlib.Path(d, 'real.fountain').write_text('INT. ROOM - DAY\n\nBOB\nHi.\n\nEXT. STREET - NIGHT\n\nFADE OUT.\n')
w = ScanWorker([d], 0.35)
hits = []
w.found.connect(lambda e: hits.append(e.name))
w.finished.connect(lambda f, u: print('found', f, 'unreadable', u))
w.run()
print('hits', hits)
assert hits == ['real.fountain'], hits
print('ok')
"
```
Expected: prints `found 1 unreadable 0`, `hits ['real.fountain']`, `ok`.

- [ ] **Step 3: Commit**

```bash
git add scenesearch/ui/scan_worker.py
git commit -m "feat: add background Qt scan worker"
```

---

### Task 10: Main window, entry point, and README

**Files:**
- Create: `scenesearch/ui/main_window.py`
- Create: `app.py`
- Create: `README.md`

**Interfaces:**
- Consumes: `ScanWorker` (Task 9); `default_roots` (Task 5); `DEFAULT_THRESHOLD` (Task 3); `ScoreCache` (Task 6); `fileops` (Task 7); `ScriptEntry` (Task 2).
- Produces: `MainWindow(QMainWindow)`; `app.py` `main()` entry point launching the Qt app.

- [ ] **Step 1: Write the main window**

`scenesearch/ui/main_window.py`:
```python
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QSortFilterProxyModel, QThread
from PySide6.QtGui import QStandardItem, QStandardItemModel
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QTableView,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from ..cache import ScoreCache
from ..classifier import DEFAULT_THRESHOLD
from ..scanner import default_roots
from .. import fileops
from .scan_worker import ScanWorker

COLUMNS = ["Name", "Folder", "Type", "Size", "Modified", "Confidence"]
_ENTRY_ROLE = Qt.UserRole + 1
_SORT_ROLE = Qt.UserRole + 2


def _human_size(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Scene Search")
        self.resize(1000, 640)

        self._cache = ScoreCache(Path.home() / ".scenesearch_cache.json")
        self._thread: QThread | None = None
        self._worker: ScanWorker | None = None

        self._build_ui()
        for root in default_roots():
            self.roots_list.addItem(str(root))

    # ---------- UI construction ----------
    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)

        # Roots row
        roots_row = QHBoxLayout()
        self.roots_list = QListWidget()
        self.roots_list.setMaximumHeight(90)
        roots_row.addWidget(self.roots_list, 1)
        roots_btns = QVBoxLayout()
        add_btn = QPushButton("Add Folder…")
        add_btn.clicked.connect(self._add_folder)
        remove_btn = QPushButton("Remove")
        remove_btn.clicked.connect(self._remove_folder)
        roots_btns.addWidget(add_btn)
        roots_btns.addWidget(remove_btn)
        roots_btns.addStretch(1)
        roots_row.addLayout(roots_btns)
        layout.addLayout(roots_row)

        # Controls row
        controls = QHBoxLayout()
        self.scan_btn = QPushButton("Scan")
        self.scan_btn.clicked.connect(self._start_scan)
        self.cancel_btn = QPushButton("Cancel")
        self.cancel_btn.clicked.connect(self._cancel_scan)
        self.cancel_btn.setEnabled(False)
        self.filter_edit = QLineEdit()
        self.filter_edit.setPlaceholderText("Filter by name…")
        self.filter_edit.textChanged.connect(self._apply_filter)
        controls.addWidget(self.scan_btn)
        controls.addWidget(self.cancel_btn)
        controls.addWidget(QLabel("Filter:"))
        controls.addWidget(self.filter_edit, 1)
        layout.addLayout(controls)

        # Progress + status
        self.progress = QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.setVisible(False)
        layout.addWidget(self.progress)
        self.status = QLabel("Ready. Add folders if you like, then click Scan.")
        layout.addWidget(self.status)

        # Table
        self.model = QStandardItemModel(0, len(COLUMNS))
        self.model.setHorizontalHeaderLabels(COLUMNS)
        self.proxy = QSortFilterProxyModel()
        self.proxy.setSourceModel(self.model)
        self.proxy.setSortRole(_SORT_ROLE)
        self.proxy.setFilterCaseSensitivity(Qt.CaseInsensitive)
        self.proxy.setFilterKeyColumn(0)
        self.table = QTableView()
        self.table.setModel(self.proxy)
        self.table.setSortingEnabled(True)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.selectionModel().selectionChanged.connect(self._on_select)
        layout.addWidget(self.table, 1)

        # Detail + actions
        self.detail = QTextEdit()
        self.detail.setReadOnly(True)
        self.detail.setMaximumHeight(110)
        layout.addWidget(self.detail)

        actions = QHBoxLayout()
        self.open_btn = QPushButton("Open")
        self.open_btn.clicked.connect(self._action_open)
        self.reveal_btn = QPushButton("Reveal in Finder")
        self.reveal_btn.clicked.connect(self._action_reveal)
        self.rename_btn = QPushButton("Rename…")
        self.rename_btn.clicked.connect(self._action_rename)
        self.copy_btn = QPushButton("Copy to…")
        self.copy_btn.clicked.connect(self._action_copy)
        self.move_btn = QPushButton("Move to…")
        self.move_btn.clicked.connect(self._action_move)
        self.trash_btn = QPushButton("Delete to Trash")
        self.trash_btn.clicked.connect(self._action_trash)
        for b in (
            self.open_btn,
            self.reveal_btn,
            self.rename_btn,
            self.copy_btn,
            self.move_btn,
            self.trash_btn,
        ):
            actions.addWidget(b)
        layout.addLayout(actions)
        self._set_actions_enabled(False)

    # ---------- Roots ----------
    def _add_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Add folder to scan")
        if folder:
            self.roots_list.addItem(folder)

    def _remove_folder(self) -> None:
        for item in self.roots_list.selectedItems():
            self.roots_list.takeItem(self.roots_list.row(item))

    def _roots(self) -> list[str]:
        return [self.roots_list.item(i).text() for i in range(self.roots_list.count())]

    # ---------- Scanning ----------
    def _start_scan(self) -> None:
        roots = self._roots()
        if not roots:
            QMessageBox.warning(self, "No folders", "Add at least one folder to scan.")
            return
        self.model.removeRows(0, self.model.rowCount())
        self._unreadable_count = 0
        self.progress.setVisible(True)
        self.scan_btn.setEnabled(False)
        self.cancel_btn.setEnabled(True)
        self.status.setText("Scanning…")

        self._thread = QThread()
        self._worker = ScanWorker(roots, DEFAULT_THRESHOLD, self._cache)
        self._worker.moveToThread(self._thread)
        self._thread.started.connect(self._worker.run)
        self._worker.found.connect(self._on_found)
        self._worker.unreadable.connect(self._on_unreadable)
        self._worker.progress.connect(self._on_progress)
        self._worker.finished.connect(self._on_finished)
        self._worker.finished.connect(self._thread.quit)
        self._thread.start()

    def _cancel_scan(self) -> None:
        if self._worker:
            self._worker.cancel()
        self.status.setText("Cancelling…")

    def _on_progress(self, scanned: int, current: str) -> None:
        self.status.setText(f"Scanning… {scanned} files checked")

    def _on_unreadable(self, path: str, reason: str) -> None:
        self._unreadable_count += 1

    def _on_found(self, entry) -> None:
        row = [
            self._cell(entry.name, entry.name),
            self._cell(str(entry.folder), str(entry.folder)),
            self._cell(entry.file_type, entry.file_type),
            self._cell(_human_size(entry.size_bytes), entry.size_bytes),
            self._cell(entry.modified.strftime("%Y-%m-%d %H:%M"), entry.modified.timestamp()),
            self._cell(f"{entry.confidence:.0%}", entry.confidence),
        ]
        row[0].setData(entry, _ENTRY_ROLE)
        self.model.appendRow(row)

    @staticmethod
    def _cell(display, sort_value) -> QStandardItem:
        item = QStandardItem(str(display))
        item.setEditable(False)
        item.setData(sort_value, _SORT_ROLE)
        return item

    def _on_finished(self, total_found: int, total_unreadable: int) -> None:
        self.progress.setVisible(False)
        self.scan_btn.setEnabled(True)
        self.cancel_btn.setEnabled(False)
        self.status.setText(
            f"Done. {total_found} script(s) found · "
            f"{total_unreadable} file(s) couldn't be read."
        )

    # ---------- Filter / selection ----------
    def _apply_filter(self, text: str) -> None:
        self.proxy.setFilterFixedString(text)

    def _selected_entry(self):
        indexes = self.table.selectionModel().selectedRows()
        if not indexes:
            return None
        source_index = self.proxy.mapToSource(indexes[0])
        name_item = self.model.item(source_index.row(), 0)
        return name_item.data(_ENTRY_ROLE)

    def _on_select(self, *args) -> None:
        entry = self._selected_entry()
        if entry is None:
            self.detail.clear()
            self._set_actions_enabled(False)
            return
        cues = "\n".join(f"  • {c}" for c in entry.matched_cues) or "  (none)"
        self.detail.setPlainText(
            f"{entry.path}\n\nConfidence: {entry.confidence:.0%}\nMatched cues:\n{cues}"
        )
        self._set_actions_enabled(True)

    def _set_actions_enabled(self, enabled: bool) -> None:
        for b in (
            self.open_btn,
            self.reveal_btn,
            self.rename_btn,
            self.copy_btn,
            self.move_btn,
            self.trash_btn,
        ):
            b.setEnabled(enabled)

    # ---------- Actions ----------
    def _action_open(self) -> None:
        entry = self._selected_entry()
        if entry:
            fileops.open_external(entry.path)

    def _action_reveal(self) -> None:
        entry = self._selected_entry()
        if entry:
            fileops.reveal_in_finder(entry.path)

    def _action_rename(self) -> None:
        entry = self._selected_entry()
        if not entry:
            return
        from PySide6.QtWidgets import QInputDialog

        new_name, ok = QInputDialog.getText(
            self, "Rename", "New file name:", text=entry.name
        )
        if ok and new_name and new_name != entry.name:
            try:
                fileops.rename(entry.path, new_name)
                self.status.setText(f"Renamed to {new_name}. Re-scan to refresh.")
            except Exception as exc:
                QMessageBox.critical(self, "Rename failed", str(exc))

    def _action_copy(self) -> None:
        entry = self._selected_entry()
        if not entry:
            return
        dest = QFileDialog.getExistingDirectory(self, "Copy to folder")
        if dest:
            try:
                result = fileops.copy_to(entry.path, dest)
                self.status.setText(f"Copied to {result}")
            except Exception as exc:
                QMessageBox.critical(self, "Copy failed", str(exc))

    def _action_move(self) -> None:
        entry = self._selected_entry()
        if not entry:
            return
        dest = QFileDialog.getExistingDirectory(self, "Move to folder")
        if not dest:
            return
        if (
            QMessageBox.question(
                self, "Move file", f"Move '{entry.name}' to:\n{dest}?"
            )
            != QMessageBox.Yes
        ):
            return
        try:
            result = fileops.move_to(entry.path, dest)
            self.status.setText(f"Moved to {result}. Re-scan to refresh.")
        except Exception as exc:
            QMessageBox.critical(self, "Move failed", str(exc))

    def _action_trash(self) -> None:
        entry = self._selected_entry()
        if not entry:
            return
        if (
            QMessageBox.question(
                self, "Delete to Trash", f"Move '{entry.name}' to the Trash?"
            )
            != QMessageBox.Yes
        ):
            return
        try:
            fileops.delete_to_trash(entry.path)
            self.status.setText(f"Moved '{entry.name}' to Trash. Re-scan to refresh.")
        except Exception as exc:
            QMessageBox.critical(self, "Delete failed", str(exc))
```

- [ ] **Step 2: Write the entry point**

`app.py`:
```python
import sys

from PySide6.QtWidgets import QApplication

from scenesearch.ui.main_window import MainWindow


def main() -> None:
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Verify it imports without launching the GUI**

Run:
```bash
.venv/bin/python -c "from scenesearch.ui.main_window import MainWindow; print('import ok')"
```
Expected: prints `import ok` (no Qt errors).

- [ ] **Step 4: Manually launch and verify the app**

Run: `.venv/bin/python app.py`

Verify by hand:
1. Window opens; the default folders appear in the list.
2. Click **Scan** — progress shows, scripts stream into the table, status ends with a "Done. N script(s) found" summary.
3. Click a column header — rows sort (Confidence and Size sort numerically).
4. Type in **Filter** — table narrows by name.
5. Select a row — detail pane shows the path + matched cues; action buttons enable.
6. Click **Reveal in Finder** — Finder highlights the file.
7. Click **Open** — the PDF opens in the default app (this confirms PDF text extraction worked end-to-end on a real script).

> If no scripts appear but you expect some, lower the bar temporarily by testing the classifier on a known script's extracted text, or confirm the script PDFs actually contain selectable text (scanned/image PDFs can't be detected — a documented limitation).

- [ ] **Step 5: Write the README**

`README.md`:
```markdown
# Scene Search

A native macOS app that finds movie/TV scripts scattered across your drive,
confirms them by reading inside the files, lists them, and lets you copy, move,
rename, open, or trash them.

## Setup

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## Run

```bash
.venv/bin/python app.py
```

## What it scans

By default: Downloads, Desktop, Documents, and iCloud Drive Documents. Add more
folders in the app. It looks at `.pdf .fountain .fdx .txt .docx` files and only
lists the ones that read like screenplays (INT./EXT. headings, FADE IN, etc.).

## Notes

- Delete always moves files to the Trash — never a permanent delete.
- Scanned/image-only PDFs have no text to read, so they can't be detected.
- After renaming/moving/deleting from the app, click Scan again to refresh.
```

- [ ] **Step 6: Run the full test suite one last time**

Run: `.venv/bin/python -m pytest -v`
Expected: PASS (all tests green).

- [ ] **Step 7: Commit**

```bash
git add scenesearch/ui/main_window.py app.py README.md
git commit -m "feat: add main window, entry point, and README"
```

---

## Self-Review

**Spec coverage:**
- Tech stack (PySide6 + pypdf + python-docx + send2trash) → Task 1. ✓
- `ScriptEntry` model → Task 2. ✓
- Content classifier with screenplay cues + threshold → Task 3. ✓
- Per-format extraction (pdf/docx/fdx/txt/fountain) + ExtractionError → Task 4. ✓
- Scanner with default roots, extension filter, skip rules → Task 5. ✓
- mtime cache → Task 6. ✓
- File ops (copy/move/rename/trash/open/reveal) + collision handling → Task 7. ✓
- Pipeline streaming found/unreadable/progress, image-PDF unreadable path → Task 8. ✓
- Background QThread worker, cancellable → Task 9. ✓
- Main window: roots add/remove, scan/cancel, progress, filter, sortable table, detail pane, actions, confirm on destructive ops, "couldn't read" count → Task 10. ✓
- README + run instructions → Task 10. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every test step contains real assertions.

**Type consistency:** `score() -> (float, list[str])` consumed consistently in pipeline; `ScriptEntry.from_path(path, confidence, matched_cues)` used identically in pipeline; `ScoreCache.get/put` signatures match between Tasks 6 and 8; worker signals match what `MainWindow` connects in Task 10; `fileops` function names match their call sites in Task 10.
