from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QButtonGroup,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from ..finder import FilterSpec, scene_rows
from ..library import Library
from ..screenplay.gender import guess_gender
from ..theme import palette_for
from .. import fileops

_SIZE_OPTS = [("Any", (0, 50)), ("1", (1, 1)), ("2", (2, 2)), ("3", (3, 3)), ("4+", (4, 50))]
_PAIR_OPTS = [("Any", None), ("M+W", "MW"), ("M+M", "MM"), ("W+W", "WW"), ("?", "has_unknown")]
_PAIR_PRETTY = {None: "", "MW": "M + W", "MM": "M + M", "WW": "W + W", "has_unknown": "unknown"}
_ENTRY_ROLE = Qt.UserRole + 1


class BrowseView(QWidget):
    prepareRequested = Signal(object)

    def __init__(self, settings, library: Library):
        super().__init__()
        self._settings = settings
        self._library = library
        self._search = ""
        self._build_ui()
        self.refresh()

    @property
    def _pal(self):
        return palette_for(self._settings.get_theme())

    # ---------- construction ----------
    def _build_ui(self) -> None:
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(0)

        # filters
        filters = QWidget()
        filters.setObjectName("rail")
        filters.setFixedWidth(252)
        fl = QVBoxLayout(filters)
        fl.setContentsMargins(18, 18, 18, 18)
        fl.setSpacing(0)
        fl.addWidget(self._section("SCENE SIZE"))
        self._size_group = self._chip_row(fl, _SIZE_OPTS, default=2)
        fl.addSpacing(6)
        fl.addWidget(self._section("PARTNER PAIRING"))
        self._pairing_group = self._chip_row(fl, _PAIR_OPTS, default=0)
        fl.addStretch(1)
        row.addWidget(filters)

        # list
        listpane = QWidget()
        listpane.setObjectName("listPane")
        ll = QVBoxLayout(listpane)
        ll.setContentsMargins(0, 0, 0, 0)
        ll.setSpacing(0)
        header = QWidget()
        header.setObjectName("listHeader")
        header.setFixedHeight(46)
        hl = QHBoxLayout(header)
        hl.setContentsMargins(20, 0, 20, 0)
        self.count_label = QLabel("")
        self.count_label.setObjectName("muted")
        hl.addWidget(self.count_label)
        hl.addStretch(1)
        ll.addWidget(header)
        self.list = QListWidget()
        self.list.setSpacing(1)
        self.list.itemSelectionChanged.connect(self._on_select)
        self.list.itemDoubleClicked.connect(self._on_open_item)
        ll.addWidget(self.list, 1)
        row.addWidget(listpane, 1)

        # detail
        detail = QWidget()
        detail.setObjectName("panel")
        detail.setFixedWidth(372)
        dl = QVBoxLayout(detail)
        dl.setContentsMargins(22, 22, 22, 22)
        dl.setSpacing(8)
        self.detail_heading = QLabel("")
        self.detail_heading.setObjectName("mono")
        self.detail_title = QLabel("")
        self.detail_title.setObjectName("detailTitle")
        self.detail_title.setWordWrap(True)
        self.tags_row = QHBoxLayout()
        self.tags_row.setSpacing(6)
        tags_w = QWidget()
        tags_w.setLayout(self.tags_row)
        dl.addWidget(self.detail_heading)
        dl.addWidget(self.detail_title)
        dl.addWidget(tags_w)

        self.card = QWidget()
        self.card.setObjectName("scriptCard")
        self._card_layout = QVBoxLayout(self.card)
        self._card_layout.setContentsMargins(22, 22, 22, 22)
        dl.addWidget(self.card, 1)

        btns = QHBoxLayout()
        btns.setSpacing(9)
        self.prepare_btn = QPushButton("Prepare scene →")
        self.prepare_btn.setObjectName("primary")
        self.prepare_btn.clicked.connect(self._on_prepare)
        self.open_btn = QPushButton("Open file")
        self.open_btn.clicked.connect(self._on_open)
        self.reveal_btn = QPushButton("Reveal")
        self.reveal_btn.clicked.connect(self._on_reveal)
        btns.addWidget(self.prepare_btn, 1)
        btns.addWidget(self.open_btn)
        btns.addWidget(self.reveal_btn)
        dl.addLayout(btns)
        row.addWidget(detail)

    def _section(self, text: str) -> QLabel:
        lab = QLabel(text)
        lab.setObjectName("sectionLabel")
        lab.setContentsMargins(0, 8, 0, 8)
        return lab

    def _chip_row(self, parent_layout, options, default: int) -> QButtonGroup:
        wrap = QWidget()
        fl = QHBoxLayout(wrap)
        fl.setContentsMargins(0, 0, 0, 0)
        fl.setSpacing(5)
        group = QButtonGroup(self)
        group.setExclusive(True)
        for i, (label, value) in enumerate(options):
            b = QPushButton(label)
            b.setObjectName("chip")
            b.setCheckable(True)
            b.setCursor(Qt.PointingHandCursor)
            b.setProperty("value", value)
            group.addButton(b, i)
            fl.addWidget(b)
            if i == default:
                b.setChecked(True)
        fl.addStretch(1)
        group.buttonClicked.connect(lambda _b: self.refresh())
        parent_layout.addWidget(wrap)
        return group

    # ---------- filtering ----------
    def set_search(self, text: str) -> None:
        self._search = (text or "").lower()
        self.refresh()

    def _spec(self) -> FilterSpec:
        mn, mx = self._size_group.checkedButton().property("value")
        pairing = self._pairing_group.checkedButton().property("value")
        return FilterSpec(min_chars=mn, max_chars=mx, pairing=pairing)

    def refresh(self) -> None:
        self.list.clear()
        rows = [m for m in scene_rows(self._library, self._spec())
                if not self._search
                or self._search in m.script_name.lower()
                or self._search in m.heading.lower()]
        for m in rows:
            item = QListWidgetItem(self.list)
            item.setData(_ENTRY_ROLE, m)
            widget = self._row_widget(m)
            item.setSizeHint(widget.sizeHint())
            self.list.setItemWidget(item, widget)
        self.count_label.setText(f"{len(rows)} scene{'s' if len(rows) != 1 else ''}")
        if rows:
            self.list.setCurrentRow(0)

    # ---------- row + chips ----------
    def _row_widget(self, m) -> QWidget:
        w = QWidget()
        w.setStyleSheet("background: transparent;")
        lay = QHBoxLayout(w)
        lay.setContentsMargins(12, 9, 12, 9)
        lay.setSpacing(10)
        col = QVBoxLayout()
        col.setSpacing(3)
        title = QLabel(m.script_name.rsplit(".", 1)[0])
        title.setStyleSheet(f"font-size:14px; font-weight:600; color:{self._pal['text']};")
        sub = QLabel(f"{m.heading}" + (f"  ·  p.{m.page}" if m.page else ""))
        sub.setStyleSheet(f"font-family:'Courier Prime',monospace; font-size:11px; color:{self._pal['text_3']};")
        col.addWidget(title)
        col.addWidget(sub)
        lay.addLayout(col, 1)
        chips = QHBoxLayout()
        chips.setSpacing(4)
        for name in m.characters[:3]:
            chips.addWidget(self._gender_chip(name))
        chips_w = QWidget()
        chips_w.setStyleSheet("background: transparent;")
        chips_w.setLayout(chips)
        lay.addWidget(chips_w, 0, Qt.AlignVCenter)
        return w

    def _gender_chip(self, name: str) -> QLabel:
        g = guess_gender(name)
        if g == "female":
            bg, fg, letter = self._pal["w_bg"], self._pal["w_fg"], "W"
        elif g == "male":
            bg, fg, letter = self._pal["m_bg"], self._pal["m_fg"], "M"
        else:
            bg, fg, letter = self._pal["chip"], self._pal["text_3"], "?"
        chip = QLabel(letter)
        chip.setFixedSize(20, 20)
        chip.setAlignment(Qt.AlignCenter)
        chip.setToolTip(name)
        chip.setStyleSheet(
            f"background:{bg}; color:{fg}; border-radius:10px; font-size:10px; font-weight:700;"
        )
        return chip

    def _tag(self, text: str) -> QLabel:
        lab = QLabel(text)
        lab.setObjectName("tagChip")
        return lab

    # ---------- selection / detail ----------
    def _selected(self):
        item = self.list.currentItem()
        return item.data(_ENTRY_ROLE) if item else None

    def _on_select(self) -> None:
        m = self._selected()
        if m is None:
            return
        self.detail_heading.setText(m.heading)
        self.detail_title.setText(m.script_name.rsplit(".", 1)[0])
        # tag chips
        while self.tags_row.count():
            child = self.tags_row.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        n = len(m.characters)
        size_label = "Two-hander" if n == 2 else (f"{n} cast" if n else "No dialogue")
        self.tags_row.addWidget(self._tag(size_label))
        if m.pairing:
            self.tags_row.addWidget(self._tag(_PAIR_PRETTY.get(m.pairing, m.pairing)))
        self.tags_row.addStretch(1)
        # script card
        while self._card_layout.count():
            child = self._card_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        h = QLabel(m.heading)
        h.setStyleSheet(f"font-family:'Courier Prime',monospace; font-size:11px; color:{self._pal['text_3']};")
        self._card_layout.addWidget(h)
        self._card_layout.addSpacing(14)
        for name in m.characters:
            cue = QLabel(name)
            cue.setAlignment(Qt.AlignHCenter)
            cue.setStyleSheet(f"font-family:'Courier Prime',monospace; font-size:13px; color:{self._pal['text']}; letter-spacing:1px;")
            self._card_layout.addWidget(cue)
        self._card_layout.addStretch(1)
        note = QLabel("Open the file or Prepare the scene to read the full sides.")
        note.setObjectName("muted")
        note.setWordWrap(True)
        self._card_layout.addWidget(note)

    # ---------- actions ----------
    def _on_open_item(self, item) -> None:
        m = item.data(_ENTRY_ROLE)
        if m:
            fileops.open_external(m.script_path)

    def _on_open(self) -> None:
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
