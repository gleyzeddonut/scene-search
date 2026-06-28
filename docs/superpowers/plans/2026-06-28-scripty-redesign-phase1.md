# Scripty Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand to Scripty and rebuild the UI into a themed nav-rail shell (Browse · Prepare-placeholder · Library), reusing the existing scan/index/finder engine. (Prepare/Sides and dialogue capture are Phase 2.)

**Architecture:** Add a GUI-free `theme.py` (palettes + QSS, unit-tested). Replace the QTabWidget/Search/Finder UI with `app_shell` (toolbar + nav rail + QStackedWidget) hosting `browse_view` and `library_view`, themed via QSS with bundled fonts. Keep the menu bar + updater banner. Rebrand the build and add a swap-script rename migration.

**Tech Stack:** Python 3, PySide6 (QSS theming, QFontDatabase), existing engine modules.

## Global Constraints

- macOS only; native title bar (no frameless chrome).
- Brand surface is **Scripty**; the Python package stays `scenesearch`.
- The updater keeps polling `gleyzeddonut/scene-search`; the repo is NOT renamed.
- Core modules under `scenesearch/` (including `theme.py`) must NOT import PySide6 — only `scenesearch/ui/` and `app.py` may. (CI installs no PySide6.)
- Bundled fonts are OFL-licensed (Space Grotesk, Courier Prime), committed under `scenesearch/fonts/` and added to the PyInstaller spec `datas`.
- Phase 1 reuses the existing engine unchanged: no parser/library schema changes. Browse filters are **Scene size** and **Partner pairing** only (Run/Length arrive in Phase 2).
- Theme persists via settings; default `"light"`.

---

### Task 1: Theme persistence in Settings

**Files:**
- Modify: `scenesearch/settings.py`
- Test: `tests/test_settings.py`

**Interfaces:**
- Produces: `Settings.get_theme() -> str` (`"light"`/`"dark"`, default `"light"`); `Settings.set_theme(name: str) -> None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_settings.py`:
```python
def test_theme_defaults_light(tmp_path):
    assert Settings(tmp_path / "s.json").get_theme() == "light"


def test_theme_round_trip(tmp_path):
    p = tmp_path / "s.json"
    Settings(p).set_theme("dark")
    assert Settings(p).get_theme() == "dark"


def test_theme_invalid_falls_back_to_light(tmp_path):
    p = tmp_path / "s.json"
    Settings(p).set_theme("rainbow")
    assert Settings(p).get_theme() == "light"
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_settings.py -k theme -v`
Expected: FAIL with `AttributeError: 'Settings' object has no attribute 'get_theme'`.

- [ ] **Step 3: Implement**

In `scenesearch/settings.py`, add to the `Settings` class (after `set_check_updates`):
```python
    def get_theme(self) -> str:
        value = self._data.get("theme")
        return value if value in ("light", "dark") else "light"

    def set_theme(self, name: str) -> None:
        self._data["theme"] = name if name in ("light", "dark") else "light"
        self.save()
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_settings.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scenesearch/settings.py tests/test_settings.py
git commit -m "feat: persist theme choice in settings"
```

---

### Task 2: Theme palettes + QSS (GUI-free)

**Files:**
- Create: `scenesearch/theme.py`
- Test: `tests/test_theme.py`

**Interfaces:**
- Produces: `TOKENS: tuple[str,...]` (required palette keys); `LIGHT: dict[str,str]`, `DARK: dict[str,str]` (hex colors); `palette_for(name: str) -> dict[str,str]`; `build_qss(palette: dict) -> str`.

- [ ] **Step 1: Write the failing tests**

`tests/test_theme.py`:
```python
from scenesearch.theme import TOKENS, LIGHT, DARK, palette_for, build_qss


def test_palettes_define_all_tokens():
    for palette in (LIGHT, DARK):
        for token in TOKENS:
            assert token in palette, token
            assert palette[token].startswith("#")


def test_palette_for():
    assert palette_for("dark") is DARK
    assert palette_for("light") is LIGHT
    assert palette_for("nonsense") is LIGHT  # safe default


def test_build_qss_includes_colors():
    qss = build_qss(LIGHT)
    assert isinstance(qss, str) and len(qss) > 200
    assert LIGHT["window"] in qss
    assert LIGHT["accent"] in qss
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_theme.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.theme'`.

- [ ] **Step 3: Implement**

`scenesearch/theme.py`:
```python
"""Color palettes (mockup oklch values approximated to hex) and the QSS builder.
GUI-free so it can be unit-tested without PySide6."""
from __future__ import annotations

TOKENS = (
    "app_bg", "chrome", "rail", "nav", "panel", "window",
    "border", "border_soft", "text", "text_2", "text_3",
    "accent", "accent_soft", "accent_text", "chip", "sel", "field",
    "w_bg", "w_fg", "m_bg", "m_fg",
)

LIGHT = {
    "app_bg": "#f1f1f4", "chrome": "#f6f6f8", "rail": "#fafafc", "nav": "#f3f3f6",
    "panel": "#f5f5f8", "window": "#fdfdff", "border": "#e3e3ea", "border_soft": "#ededf2",
    "text": "#2c2c38", "text_2": "#66667a", "text_3": "#9090a0",
    "accent": "#5b53e0", "accent_soft": "#ecebfb", "accent_text": "#5048c8",
    "chip": "#ececf1", "sel": "#eceaf9", "field": "#f0f0f4",
    "w_bg": "#f0c4bf", "w_fg": "#8a4a44", "m_bg": "#bdd1e8", "m_fg": "#3f5d80",
}

DARK = {
    "app_bg": "#15151c", "chrome": "#1b1b23", "rail": "#1d1d26", "nav": "#18181f",
    "panel": "#1d1d26", "window": "#22222c", "border": "#34343f", "border_soft": "#2a2a33",
    "text": "#e8e8ef", "text_2": "#b1b1c0", "text_3": "#85859a",
    "accent": "#8a7dff", "accent_soft": "#34306a", "accent_text": "#c3bdf5",
    "chip": "#2a2a33", "sel": "#34315e", "field": "#232330",
    "w_bg": "#7c4a48", "w_fg": "#f0cfca", "m_bg": "#46566e", "m_fg": "#cfdcec",
}


def palette_for(name: str) -> dict:
    return DARK if name == "dark" else LIGHT


def build_qss(p: dict) -> str:
    return f"""
    QWidget {{ background: {p['window']}; color: {p['text']};
        font-family: 'Space Grotesk', -apple-system, sans-serif; font-size: 13px; }}
    QMainWindow, #shell {{ background: {p['app_bg']}; }}
    #toolbar {{ background: {p['chrome']}; border-bottom: 1px solid {p['border']}; }}
    #navRail {{ background: {p['nav']}; border-right: 1px solid {p['border']}; }}
    #rail {{ background: {p['rail']}; border-right: 1px solid {p['border']}; }}
    #panel {{ background: {p['panel']}; }}
    #wordmark {{ font-size: 15px; font-weight: 700; }}
    QLineEdit {{ background: {p['field']}; border: 1px solid {p['border']};
        border-radius: 9px; padding: 6px 10px; color: {p['text']}; }}
    QPushButton {{ background: {p['chip']}; border: 1px solid {p['border']};
        border-radius: 8px; padding: 7px 12px; color: {p['text_2']}; }}
    QPushButton:hover {{ border-color: {p['accent']}; }}
    QPushButton#primary {{ background: {p['accent']}; color: white; border: none; }}
    QPushButton#navItem {{ background: transparent; border: none; color: {p['text_3']};
        border-radius: 9px; padding: 8px 4px; font-size: 10px; font-weight: 600; }}
    QPushButton#navItem:checked {{ background: {p['accent_soft']}; color: {p['accent_text']}; }}
    QTreeView, QListWidget {{ background: {p['window']}; border: none;
        outline: 0; alternate-background-color: {p['window']}; }}
    QTreeView::item, QListWidget::item {{ padding: 6px 8px; border-radius: 7px; }}
    QTreeView::item:selected, QListWidget::item:selected {{
        background: {p['sel']}; color: {p['text']}; }}
    QHeaderView::section {{ background: {p['window']}; color: {p['text_3']};
        border: none; border-bottom: 1px solid {p['border_soft']};
        padding: 6px 8px; font-size: 10px; }}
    QLabel#sectionLabel {{ color: {p['text_3']}; font-size: 10px; font-weight: 700; }}
    QLabel#mono {{ font-family: 'Courier Prime', monospace; color: {p['text_2']}; }}
    QScrollBar:vertical {{ background: transparent; width: 9px; }}
    QScrollBar::handle:vertical {{ background: {p['border']}; border-radius: 4px; }}
    """
```

- [ ] **Step 4: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_theme.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/theme.py tests/test_theme.py
git commit -m "feat: theme palettes (light/dark) and QSS builder"
```

---

### Task 3: Bundle fonts

**Files:**
- Create: `scenesearch/fonts/SpaceGrotesk.ttf`, `scenesearch/fonts/CourierPrime.ttf` (downloaded)
- Create: `scenesearch/fonts/__init__.py`
- Create: `packaging/build_fonts.py`
- Modify: `packaging/Scene Search.spec`

**Interfaces:**
- Produces: TTF files on disk under `scenesearch/fonts/`, bundled into the app.

- [ ] **Step 1: Write the fetch script**

`packaging/build_fonts.py`:
```python
"""Download the OFL-licensed UI fonts into scenesearch/fonts/.
Run once: .venv/bin/python packaging/build_fonts.py"""
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "scenesearch" / "fonts"
FONTS = {
    "SpaceGrotesk.ttf": "https://github.com/google/fonts/raw/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf",
    "CourierPrime.ttf": "https://github.com/google/fonts/raw/main/ofl/courierprime/CourierPrime-Regular.ttf",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, url in FONTS.items():
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=120).read()
        (OUT / name).write_bytes(data)
        print(f"wrote {name} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it (download the fonts)**

Run: `.venv/bin/python packaging/build_fonts.py`
Expected: prints both files written. Then:
Run: `ls -lh scenesearch/fonts/`
Expected: two `.ttf` files (tens–hundreds of KB each).

- [ ] **Step 3: Create the package marker**

`scenesearch/fonts/__init__.py`:
```python
```

- [ ] **Step 4: Bundle the fonts in the spec**

In `packaging/Scene Search.spec`, extend the `datas=[...]` list to also include the fonts dir — change it to:
```python
    datas=[
        (
            os.path.join(PROJECT_ROOT, "scenesearch", "screenplay", "names_gender.json"),
            "scenesearch/screenplay",
        ),
        (
            os.path.join(PROJECT_ROOT, "scenesearch", "fonts"),
            "scenesearch/fonts",
        ),
    ],
```

- [ ] **Step 5: Commit**

```bash
git add scenesearch/fonts packaging/build_fonts.py "packaging/Scene Search.spec"
git commit -m "build: bundle Space Grotesk + Courier Prime fonts"
```

---

### Task 4: App shell (toolbar + nav rail + stacked views)

**Files:**
- Create: `scenesearch/ui/app_shell.py`

**Interfaces:**
- Consumes: `theme.palette_for`, `theme.build_qss`; `Settings`.
- Produces: `load_app_fonts() -> None`; `AppShell(QWidget)` with `nav` buttons, a `QStackedWidget` `stack`, a `search_edit`, a `theme_toggle`, signals `searchChanged(str)`, and methods `add_view(key, widget, label)`, `show_view(key)`, `apply_theme()`. Exposes `wordmark` showing "Scripty".

- [ ] **Step 1: Write the shell**

`scenesearch/ui/app_shell.py`:
```python
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFontDatabase
from PySide6.QtWidgets import (
    QButtonGroup,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from ..theme import build_qss, palette_for


def load_app_fonts() -> None:
    fonts_dir = Path(__file__).resolve().parent.parent / "fonts"
    for ttf in ("SpaceGrotesk.ttf", "CourierPrime.ttf"):
        path = fonts_dir / ttf
        if path.exists():
            QFontDatabase.addApplicationFont(str(path))


class AppShell(QWidget):
    searchChanged = Signal(str)

    def __init__(self, settings):
        super().__init__()
        self.setObjectName("shell")
        self._settings = settings
        self._views: dict[str, int] = {}
        self._nav_group = QButtonGroup(self)
        self._build_ui()
        self.apply_theme()

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # toolbar
        toolbar = QWidget()
        toolbar.setObjectName("toolbar")
        toolbar.setFixedHeight(48)
        tb = QHBoxLayout(toolbar)
        tb.setContentsMargins(16, 0, 16, 0)
        dot = QLabel("●")
        self.wordmark = QLabel("Scripty")
        self.wordmark.setObjectName("wordmark")
        self.search_edit = QLineEdit()
        self.search_edit.setPlaceholderText("Search scenes, characters…")
        self.search_edit.setFixedWidth(360)
        self.search_edit.textChanged.connect(self.searchChanged.emit)
        self.theme_toggle = QPushButton("☾" if settings_dark(self._settings) else "☀")
        self.theme_toggle.setFixedWidth(40)
        self.theme_toggle.clicked.connect(self._toggle_theme)
        tb.addWidget(dot)
        tb.addWidget(self.wordmark)
        tb.addStretch(1)
        tb.addWidget(self.search_edit)
        tb.addStretch(1)
        tb.addWidget(self.theme_toggle)
        root.addWidget(toolbar)

        # body: nav rail + stack
        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)
        rail = QWidget()
        rail.setObjectName("navRail")
        rail.setFixedWidth(74)
        self._rail_layout = QVBoxLayout(rail)
        self._rail_layout.setContentsMargins(8, 12, 8, 12)
        self._rail_layout.setSpacing(6)
        self._rail_layout.addStretch(1)
        body.addWidget(rail)
        self.stack = QStackedWidget()
        body.addWidget(self.stack, 1)
        root.addLayout(body, 1)

    def add_view(self, key: str, widget: QWidget, label: str) -> None:
        idx = self.stack.addWidget(widget)
        self._views[key] = idx
        btn = QPushButton(label)
        btn.setObjectName("navItem")
        btn.setCheckable(True)
        btn.clicked.connect(lambda: self.show_view(key))
        self._nav_group.addButton(btn)
        self._rail_layout.insertWidget(self._rail_layout.count() - 1, btn)
        if self.stack.count() == 1:
            btn.setChecked(True)

    def show_view(self, key: str) -> None:
        if key in self._views:
            self.stack.setCurrentIndex(self._views[key])

    def _toggle_theme(self) -> None:
        new = "light" if self._settings.get_theme() == "dark" else "dark"
        self._settings.set_theme(new)
        self.theme_toggle.setText("☾" if new == "dark" else "☀")
        self.apply_theme()

    def apply_theme(self) -> None:
        qss = build_qss(palette_for(self._settings.get_theme()))
        win = self.window()
        (win or self).setStyleSheet(qss)


def settings_dark(settings) -> bool:
    return settings.get_theme() == "dark"
```

- [ ] **Step 2: Verify offscreen**

Run:
```bash
QT_QPA_PLATFORM=offscreen .venv/bin/python -c "
import sys, tempfile, pathlib
from PySide6.QtWidgets import QApplication, QLabel
app = QApplication(sys.argv)
from scenesearch.ui.app_shell import AppShell, load_app_fonts
from scenesearch.settings import Settings
load_app_fonts()
s = Settings(pathlib.Path(tempfile.mkdtemp())/'s.json')
sh = AppShell(s)
sh.add_view('a', QLabel('A'), 'Browse')
sh.add_view('b', QLabel('B'), 'Library')
sh.show_view('b')
print('views:', sh.stack.count(), 'current:', sh.stack.currentIndex())
sh._toggle_theme(); print('theme now:', s.get_theme())
print('ok')
" 2>/dev/null
```
Expected: `views: 2 current: 1`, `theme now: dark`, `ok`.

- [ ] **Step 3: Commit**

```bash
git add scenesearch/ui/app_shell.py
git commit -m "feat: themed app shell (toolbar + nav rail + stacked views)"
```

---

### Task 5: Browse view

**Files:**
- Create: `scenesearch/ui/browse_view.py`

**Interfaces:**
- Consumes: `Library`, `finder.FilterSpec`/`scene_rows`/`script_rows`/`group_duplicates`; `fileops.open_external`/`reveal_in_finder`.
- Produces: `BrowseView(QWidget)` taking `(library)`, with `set_search(text)`, a `prepareRequested(object)` signal (emits the selected `SceneMatch`), and `refresh()`.

- [ ] **Step 1: Write the view**

`scenesearch/ui/browse_view.py`:
```python
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QStandardItem, QStandardItemModel
from PySide6.QtWidgets import (
    QComboBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QPushButton,
    QSpinBox,
    QTextEdit,
    QTreeView,
    QVBoxLayout,
    QWidget,
)

from ..finder import FilterSpec, scene_rows
from ..library import Library
from .. import fileops

_PAIRINGS = [("Any", None), ("Man + Woman", "MW"), ("Man + Man", "MM"),
             ("Woman + Woman", "WW"), ("Has unknown", "has_unknown")]
_PATH_ROLE = Qt.UserRole + 1
_ENTRY_ROLE = Qt.UserRole + 2


class BrowseView(QWidget):
    prepareRequested = Signal(object)

    def __init__(self, library: Library):
        super().__init__()
        self._library = library
        self._search = ""
        self._build_ui()
        self.refresh()

    def _build_ui(self) -> None:
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(0)

        # filters
        filters = QWidget()
        filters.setObjectName("rail")
        filters.setFixedWidth(248)
        fl = QVBoxLayout(filters)
        fl.setContentsMargins(16, 16, 16, 16)
        fl.addWidget(self._label("SCENE SIZE"))
        size_row = QHBoxLayout()
        self.min_spin = QSpinBox(); self.min_spin.setRange(0, 50); self.min_spin.setValue(2)
        self.max_spin = QSpinBox(); self.max_spin.setRange(0, 50); self.max_spin.setValue(2)
        size_row.addWidget(QLabel("min")); size_row.addWidget(self.min_spin)
        size_row.addWidget(QLabel("max")); size_row.addWidget(self.max_spin)
        size_row.addStretch(1)
        fl.addLayout(size_row)
        fl.addSpacing(14)
        fl.addWidget(self._label("PARTNER PAIRING"))
        self.pairing = QComboBox()
        for label, _ in _PAIRINGS:
            self.pairing.addItem(label)
        fl.addWidget(self.pairing)
        fl.addStretch(1)
        row.addWidget(filters)

        # list
        mid = QVBoxLayout()
        mid.setContentsMargins(0, 0, 0, 0)
        self.count_label = QLabel("")
        self.count_label.setContentsMargins(16, 10, 16, 10)
        mid.addWidget(self.count_label)
        self.model = QStandardItemModel()
        self.tree = QTreeView()
        self.tree.setModel(self.model)
        self.tree.setRootIsDecorated(True)
        self.tree.setHeaderHidden(False)
        self.tree.verticalScrollBar()
        self.tree.clicked.connect(self._on_select)
        self.tree.doubleClicked.connect(self._on_open)
        mid.addWidget(self.tree, 1)
        mid_w = QWidget(); mid_w.setLayout(mid)
        row.addWidget(mid_w, 1)

        # detail
        detail = QWidget()
        detail.setObjectName("panel")
        detail.setFixedWidth(360)
        dl = QVBoxLayout(detail)
        dl.setContentsMargins(20, 20, 20, 20)
        self.detail_heading = QLabel(""); self.detail_heading.setObjectName("mono")
        self.detail_title = QLabel(""); self.detail_title.setStyleSheet("font-size:20px;font-weight:700;")
        self.detail_meta = QLabel(""); self.detail_meta.setWordWrap(True)
        self.preview = QTextEdit(); self.preview.setReadOnly(True); self.preview.setObjectName("mono")
        dl.addWidget(self.detail_heading)
        dl.addWidget(self.detail_title)
        dl.addWidget(self.detail_meta)
        dl.addWidget(self.preview, 1)
        btns = QHBoxLayout()
        self.prepare_btn = QPushButton("Prepare scene →"); self.prepare_btn.setObjectName("primary")
        self.prepare_btn.clicked.connect(self._on_prepare)
        self.open_btn = QPushButton("Open file"); self.open_btn.clicked.connect(self._on_open_detail)
        self.reveal_btn = QPushButton("Reveal"); self.reveal_btn.clicked.connect(self._on_reveal)
        btns.addWidget(self.prepare_btn); btns.addWidget(self.open_btn); btns.addWidget(self.reveal_btn)
        dl.addLayout(btns)
        row.addWidget(detail)

        self.min_spin.valueChanged.connect(self.refresh)
        self.max_spin.valueChanged.connect(self.refresh)
        self.pairing.currentIndexChanged.connect(self.refresh)

    @staticmethod
    def _label(text) -> QLabel:
        lab = QLabel(text); lab.setObjectName("sectionLabel"); return lab

    def set_search(self, text: str) -> None:
        self._search = (text or "").lower()
        self.refresh()

    def _spec(self) -> FilterSpec:
        return FilterSpec(
            min_chars=self.min_spin.value(),
            max_chars=self.max_spin.value(),
            pairing=_PAIRINGS[self.pairing.currentIndex()][1],
        )

    def refresh(self) -> None:
        self.model.clear()
        self.model.setHorizontalHeaderLabels(["Scene", "Cast", "Page"])
        rows = [m for m in scene_rows(self._library, self._spec())
                if not self._search
                or self._search in m.script_name.lower()
                or self._search in m.heading.lower()]
        for m in rows:
            name = QStandardItem(f"{m.script_name}  ·  {m.heading}")
            name.setEditable(False)
            name.setData(m.script_path, _PATH_ROLE)
            name.setData(m, _ENTRY_ROLE)
            cast = QStandardItem(", ".join(m.characters)); cast.setEditable(False)
            page = QStandardItem(str(m.page) if m.page else "—"); page.setEditable(False)
            self.model.appendRow([name, page if False else cast, page])
        self.tree.header().setSectionResizeMode(0, QHeaderView.Stretch)
        self.count_label.setText(f"{len(rows)} scene(s)")

    def _selected(self):
        idx = self.tree.currentIndex()
        if not idx.isValid():
            return None
        return self.model.item(idx.siblingAtColumn(0).row(), 0).data(_ENTRY_ROLE)

    def _on_select(self, index) -> None:
        m = self.model.item(index.siblingAtColumn(0).row(), 0).data(_ENTRY_ROLE)
        if m is None:
            return
        self.detail_heading.setText(m.heading)
        self.detail_title.setText(m.script_name)
        self.detail_meta.setText(f"{', '.join(m.characters)} · {m.pairing or ''}")
        self.preview.setPlainText("\n".join(m.characters))

    def _on_open(self, index) -> None:
        path = self.model.item(index.siblingAtColumn(0).row(), 0).data(_PATH_ROLE)
        if path:
            fileops.open_external(path)

    def _on_open_detail(self) -> None:
        m = self._selected()
        if m:
            fileops.open_external(m.script_path)

    def _on_reveal(self) -> None:
        m = self._selected()
        if m:
            fileops.reveal_in_finder(m.script_path)

    def _on_prepare(self) -> None:
        m = self._selected()
        if m:
            self.prepareRequested.emit(m)
```

- [ ] **Step 2: Verify offscreen (index a tiny library, filter, select)**

Run:
```bash
QT_QPA_PLATFORM=offscreen .venv/bin/python -c "
import sys, tempfile, pathlib
from PySide6.QtWidgets import QApplication
app = QApplication(sys.argv)
from scenesearch.library import Library
from scenesearch.ui.browse_view import BrowseView
d = pathlib.Path(tempfile.mkdtemp()); lib = d/'lib'; lib.mkdir()
(lib/'x.fountain').write_text('INT. OFFICE - DAY\n\nMICHAEL\nSit.\n\nJENNIFER\nNo.\n')
L = Library(d/'i.db'); L.reindex(lib)
v = BrowseView(L); v.min_spin.setValue(2); v.max_spin.setValue(2); v.refresh()
print('rows:', v.model.rowCount(), '| count label:', v.count_label.text())
print('ok')
" 2>/dev/null
```
Expected: `rows: 1`, count label "1 scene(s)", `ok`.

- [ ] **Step 3: Commit**

```bash
git add scenesearch/ui/browse_view.py
git commit -m "feat: Browse view (size/pairing filters, scene list, detail panel)"
```

---

### Task 6: Library view

**Files:**
- Create: `scenesearch/ui/library_view.py`

**Interfaces:**
- Consumes: `Library`, `Settings`, `IndexWorker`, `scanner.default_roots`, `fileops`.
- Produces: `LibraryView(QWidget)` taking `(settings, library, index_path)` with `refresh_stats()` and a background re-index (reusing `IndexWorker`); `stop_indexing()`.

- [ ] **Step 1: Write the view**

`scenesearch/ui/library_view.py`:
```python
from __future__ import annotations

from PySide6.QtCore import QThread
from PySide6.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from ..library import Library
from ..scanner import default_roots
from .index_worker import IndexWorker


class LibraryView(QWidget):
    def __init__(self, settings, library: Library, index_path):
        super().__init__()
        self._settings = settings
        self._library = library
        self._index_path = index_path
        self._thread: QThread | None = None
        self._worker = None
        self._build_ui()
        self._load_folders()
        self.refresh_stats()

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(30, 28, 30, 28)
        title = QLabel("Library"); title.setStyleSheet("font-size:22px;font-weight:700;")
        root.addWidget(title)
        blurb = QLabel("Scripty indexes the script files on your drive — nothing leaves your Mac.")
        blurb.setWordWrap(True); root.addWidget(blurb)

        stats = QHBoxLayout()
        self.scripts_stat = self._stat("0", "scripts indexed")
        self.scenes_stat = self._stat("0", "scenes parsed")
        stats.addWidget(self.scripts_stat[0]); stats.addWidget(self.scenes_stat[0])
        stats.addStretch(1)
        root.addLayout(stats)

        hdr = QHBoxLayout()
        lbl = QLabel("INDEXED FOLDERS"); lbl.setObjectName("sectionLabel")
        add = QPushButton("Add folder…"); add.clicked.connect(self._add_folder)
        hdr.addWidget(lbl); hdr.addStretch(1); hdr.addWidget(add)
        root.addLayout(hdr)
        self.folders = QListWidget(); self.folders.setMaximumHeight(140)
        root.addWidget(self.folders)
        fbtns = QHBoxLayout()
        rm = QPushButton("Remove"); rm.clicked.connect(self._remove_folder)
        fbtns.addWidget(rm); fbtns.addStretch(1)
        root.addLayout(fbtns)

        self.progress = QProgressBar(); self.progress.setRange(0, 0); self.progress.setVisible(False)
        root.addWidget(self.progress)
        self.status = QLabel(""); root.addWidget(self.status)
        self.reindex_btn = QPushButton("Re-index now"); self.reindex_btn.setObjectName("primary")
        self.reindex_btn.clicked.connect(self._reindex)
        root.addWidget(self.reindex_btn)
        root.addStretch(1)

    @staticmethod
    def _stat(value, label):
        box = QWidget(); box.setObjectName("panel")
        v = QVBoxLayout(box)
        num = QLabel(value); num.setStyleSheet("font-size:24px;font-weight:700;")
        cap = QLabel(label); cap.setObjectName("sectionLabel")
        v.addWidget(num); v.addWidget(cap)
        return box, num

    def _load_folders(self) -> None:
        saved = self._settings.get_roots()
        roots = saved if saved is not None else [str(r) for r in default_roots()]
        for r in roots:
            self.folders.addItem(r)

    def _folders(self):
        return [self.folders.item(i).text() for i in range(self.folders.count())]

    def _persist(self) -> None:
        self._settings.set_roots(self._folders())

    def _add_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Add folder to index")
        if folder:
            self.folders.addItem(folder); self._persist()

    def _remove_folder(self) -> None:
        for item in self.folders.selectedItems():
            self.folders.takeItem(self.folders.row(item))
        self._persist()

    def refresh_stats(self) -> None:
        self.scripts_stat[1].setText(str(self._library.script_count()))
        self.scenes_stat[1].setText(str(self._library.scene_count()))

    def _reindex(self) -> None:
        roots = self._folders()
        if not roots:
            QMessageBox.warning(self, "No folders", "Add a folder first.")
            return
        # index each root via a worker chain (reuse IndexWorker for the first;
        # for multiple roots, index sequentially using the library directly off-thread)
        self.reindex_btn.setEnabled(False)
        self.progress.setVisible(True)
        self.status.setText("Indexing…")
        self._thread = QThread()
        self._worker = IndexWorker(self._index_path, roots[0])
        self._worker.moveToThread(self._thread)
        self._thread.started.connect(self._worker.run)
        self._worker.progress.connect(lambda n, name: self.status.setText(f"Indexing… {n} files ({name})"))
        self._worker.finished.connect(self._on_done)
        self._worker.failed.connect(self._on_fail)
        self._worker.finished.connect(self._thread.quit)
        self._worker.failed.connect(self._thread.quit)
        self._thread.finished.connect(self._worker.deleteLater)
        self._thread.finished.connect(self._thread.deleteLater)
        self._thread.finished.connect(self._clear)
        self._thread.start()

    def _clear(self) -> None:
        self._thread = None
        self._worker = None

    def _on_done(self, scripts, scenes) -> None:
        self.progress.setVisible(False)
        self.reindex_btn.setEnabled(True)
        self.refresh_stats()
        self.status.setText(f"Indexed: {scripts} scripts, {scenes} scenes.")

    def _on_fail(self, message) -> None:
        self.progress.setVisible(False)
        self.reindex_btn.setEnabled(True)
        QMessageBox.critical(self, "Indexing failed", message)

    def stop_indexing(self) -> None:
        if self._thread is not None and self._thread.isRunning():
            self._thread.quit(); self._thread.wait(5000)
```

> Note: Phase 1 indexes the first folder (matching today's single-library behavior). Multi-folder indexing in one pass is a small Phase 2 follow-up.

- [ ] **Step 2: Verify offscreen**

Run:
```bash
QT_QPA_PLATFORM=offscreen .venv/bin/python -c "
import sys, tempfile, pathlib
from PySide6.QtWidgets import QApplication
app = QApplication(sys.argv)
from scenesearch.library import Library
from scenesearch.settings import Settings
from scenesearch.ui.library_view import LibraryView
d = pathlib.Path(tempfile.mkdtemp())
v = LibraryView(Settings(d/'s.json'), Library(d/'i.db'), d/'i.db')
print('folders preloaded:', v.folders.count() >= 0, '| stats ok:', v.scripts_stat[1].text())
print('ok')
" 2>/dev/null
```
Expected: prints folder/stat info and `ok`.

- [ ] **Step 3: Commit**

```bash
git add scenesearch/ui/library_view.py
git commit -m "feat: Library view (stats, folders, background re-index)"
```

---

### Task 7: Wire the shell into MainWindow

**Files:**
- Modify: `scenesearch/ui/main_window.py`

**Interfaces:**
- Consumes: `AppShell`/`load_app_fonts` (Task 4), `BrowseView` (Task 5), `LibraryView` (Task 6), existing menus/updater.
- Produces: `MainWindow` whose central widget is the `AppShell` with Browse / Prepare (placeholder) / Library views; theme applied; menus + updater banner retained.

- [ ] **Step 1: Replace tabs with the shell**

In `scenesearch/ui/main_window.py`, replace the imports of `FinderTab`/`SearchTab` and the central-widget construction. Change the imports block:
```python
from .app_shell import AppShell, load_app_fonts
from .browse_view import BrowseView
from .library_view import LibraryView
```
(remove `from .finder_tab import FinderTab` and `from .search_tab import SearchTab`).

Replace the tab construction (the `self.tabs = QTabWidget()` … `addTab(...Finder...)` block) with:
```python
        load_app_fonts()
        self._library = Library(self._index_path)

        self.shell = AppShell(self._settings)
        layout.addWidget(self.shell, 1)   # 'layout' already holds the update banner

        self.browse_view = BrowseView(self._library)
        self.library_view = LibraryView(self._settings, self._library, self._index_path)
        prepare_placeholder = QLabel("Select a scene in Browse, then “Prepare scene →”.")
        prepare_placeholder.setAlignment(Qt.AlignCenter)

        self.shell.add_view("browse", self.browse_view, "Browse")
        self.shell.add_view("prepare", prepare_placeholder, "Prepare")
        self.shell.add_view("library", self.library_view, "Library")
        self.shell.searchChanged.connect(self.browse_view.set_search)
        self.browse_view.prepareRequested.connect(lambda _m: self.shell.show_view("prepare"))
```
Add imports at the top: `from PySide6.QtCore import Qt` (extend existing import), `from PySide6.QtWidgets import QLabel` (extend existing import), and `from ..library import Library`.

- [ ] **Step 2: Update closeEvent**

Replace the `self.search_tab._persist_roots()` / `self.finder_tab.stop_indexing()` lines in `closeEvent` with:
```python
        self.library_view._persist()
        self.library_view.stop_indexing()
```
(keep the update-thread stops).

- [ ] **Step 3: Update About text to Scripty**

In `_show_about`, change the title/body to say **Scripty** instead of Scene Search.

- [ ] **Step 4: Verify offscreen + full suite**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS.

Run:
```bash
QT_QPA_PLATFORM=offscreen .venv/bin/python -c "
import sys, tempfile, pathlib
from PySide6.QtWidgets import QApplication
app = QApplication(sys.argv)
from scenesearch.ui.main_window import MainWindow
d = pathlib.Path(tempfile.mkdtemp())
mw = MainWindow(settings_path=d/'s.json', cache_path=d/'c.json', index_path=d/'i.db')
print('shell views:', mw.shell.stack.count())
print('title:', mw.windowTitle())
print('ok')
" 2>/dev/null
```
Expected: `shell views: 3`, title `Scene Search` (window title still set; brand shown in toolbar wordmark), `ok`.

- [ ] **Step 5: Delete the superseded tab files**

```bash
git rm scenesearch/ui/search_tab.py scenesearch/ui/finder_tab.py
```

- [ ] **Step 6: Run full suite again and commit**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS.

```bash
git add scenesearch/ui/main_window.py
git commit -m "feat: host AppShell (Browse/Prepare/Library) in MainWindow; drop tabs"
```

---

### Task 8: Rebrand the build + updater rename migration

**Files:**
- Modify: `packaging/build_release.sh`, `packaging/Scene Search.spec`
- Modify: `scenesearch/updater.py`
- Test: `tests/test_updater_io.py`

**Interfaces:**
- Produces: `Scripty.app` builds and `Scripty-macOS-<arch>.zip`; `write_swap_script` installs the new bundle under its own name in the old bundle's parent.

- [ ] **Step 1: Write the failing test for the rename-aware swap**

Add to `tests/test_updater_io.py`:
```python
def test_swap_script_targets_new_basename(tmp_path):
    from scenesearch.updater import write_swap_script
    old = tmp_path / "Scene Search.app"
    new = tmp_path / "staged" / "Scripty.app"
    script = write_swap_script(old, new, 4242)
    text = script.read_text()
    # new bundle should be installed next to the old one, under ITS name
    assert str(tmp_path / "Scripty.app") in text
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_updater_io.py::test_swap_script_targets_new_basename -v`
Expected: FAIL (current script moves NEW onto OLD's path/name).

- [ ] **Step 3: Update `write_swap_script`**

In `scenesearch/updater.py`, replace the body of `write_swap_script` so the install target is the new bundle's basename in the old bundle's parent dir:
```python
def write_swap_script(old_app, new_app, pid) -> Path:
    old = Path(old_app)
    new = Path(new_app)
    target = old.parent / new.name  # migrate rename: install under new name
    script = f"""#!/bin/bash
OLD={shlex.quote(str(old))}
NEW={shlex.quote(str(new))}
TARGET={shlex.quote(str(target))}
PID={int(pid)}
for _ in $(seq 1 120); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.5
done
rm -rf "$TARGET"
if ! ( [ "$OLD" != "$TARGET" ] && rm -rf "$OLD"; mv "$NEW" "$TARGET" ) 2>/dev/null; then
    /usr/bin/osascript -e "do shell script \\"rm -rf \\" & quoted form of \\"$OLD\\" & \\" ; mv \\" & quoted form of \\"$NEW\\" & \\" \\" & quoted form of \\"$TARGET\\" with administrator privileges"
fi
open "$TARGET"
"""
    path = Path(tempfile.mkdtemp()) / "scenesearch_swap.sh"
    path.write_text(script)
    os.chmod(path, 0o755)
    return path
```

- [ ] **Step 4: Run the swap tests**

Run: `.venv/bin/python -m pytest tests/test_updater_io.py -v`
Expected: PASS (old `test_write_swap_script` still passes — `str(old)` and `str(new)` are both present — and the new test passes).

- [ ] **Step 5: Rename the app in the build**

In `packaging/build_release.sh`, change `APP_NAME="Scene Search"` to `APP_NAME="Scripty"`.
In `packaging/Scene Search.spec`, change the BUNDLE `name="Scene Search.app"` to `name="Scripty.app"`, `CFBundleName`/`CFBundleDisplayName` to `"Scripty"`, and `bundle_identifier` to `"com.gleyzer.scripty"`. Also update the EXE/COLLECT `name="Scene Search"` to `name="Scripty"`.

- [ ] **Step 6: Verify the spec still builds the app (quick build, no notarize)**

Run: `.venv/bin/python -m pytest -q` (ensure green), then a build smoke (no signing):
```bash
rm -rf build dist && .venv/bin/pyinstaller "packaging/Scene Search.spec" --noconfirm 2>&1 | tail -3 && ls -d "dist/Scripty.app" && "dist/Scripty.app/Contents/MacOS/Scripty" --selfcheck 2>&1 | tail -1
```
Expected: `dist/Scripty.app` exists and selfcheck prints `OK`.

- [ ] **Step 7: Commit**

```bash
git add packaging/build_release.sh "packaging/Scene Search.spec" scenesearch/updater.py tests/test_updater_io.py
git commit -m "build: rebrand app bundle to Scripty + rename-aware updater swap"
```

---

## Self-Review

**Spec coverage (Phase 1 portion):**
- Theme persistence → Task 1. ✓
- Palettes + QSS (GUI-free, testable) → Task 2. ✓
- Bundled OFL fonts + spec datas → Task 3. ✓
- App shell (native title bar + toolbar + nav rail + stacked views + theme toggle) → Task 4. ✓
- Browse (size/pairing filters, scene list, detail with Open/Reveal/Prepare) → Task 5. ✓
- Library (stats, folders add/remove, background re-index) → Task 6. ✓
- MainWindow hosts shell, keeps menus + updater banner, Prepare placeholder → Task 7. ✓
- Rebrand bundle + updater rename migration → Task 8. ✓
- Phase 2 items (parser dialogue, runtime, Length filter, Prepare view, PDF) intentionally deferred.

**Placeholder scan:** No TBD/TODO; UI tasks give complete files; visual styling lives in the QSS from Task 2 and is refined after the app runs (expected per spec).

**Type consistency:** `palette_for`/`build_qss`/`TOKENS`/`LIGHT`/`DARK` consistent Tasks 2→4. `AppShell.add_view/show_view/searchChanged/apply_theme` consistent Tasks 4→7. `BrowseView(library)` + `prepareRequested`/`set_search` consistent Tasks 5→7. `LibraryView(settings, library, index_path)` + `_persist`/`stop_indexing` consistent Tasks 6→7. `write_swap_script(old, new, pid)` signature unchanged (Task 8 only changes the body/target). `Settings.get_theme/set_theme` consistent Tasks 1→4.
