from __future__ import annotations

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

        mid = QVBoxLayout()
        mid.setContentsMargins(0, 0, 0, 0)
        self.count_label = QLabel("")
        self.count_label.setContentsMargins(16, 10, 16, 10)
        mid.addWidget(self.count_label)
        self.model = QStandardItemModel()
        self.tree = QTreeView()
        self.tree.setModel(self.model)
        self.tree.setRootIsDecorated(False)
        self.tree.setHeaderHidden(False)
        self.tree.clicked.connect(self._on_select)
        self.tree.doubleClicked.connect(self._on_open)
        mid.addWidget(self.tree, 1)
        mid_w = QWidget(); mid_w.setLayout(mid)
        row.addWidget(mid_w, 1)

        detail = QWidget()
        detail.setObjectName("panel")
        detail.setFixedWidth(360)
        dl = QVBoxLayout(detail)
        dl.setContentsMargins(20, 20, 20, 20)
        self.detail_heading = QLabel(""); self.detail_heading.setObjectName("mono")
        self.detail_title = QLabel(""); self.detail_title.setStyleSheet("font-size:20px;font-weight:700;")
        self.detail_title.setWordWrap(True)
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
            self.model.appendRow([name, cast, page])
        self.tree.header().setSectionResizeMode(0, QHeaderView.Stretch)
        self.count_label.setText(f"{len(rows)} scene(s)")

    def _entry_at(self, index):
        if not index.isValid():
            return None
        return self.model.item(index.siblingAtColumn(0).row(), 0).data(_ENTRY_ROLE)

    def _selected(self):
        return self._entry_at(self.tree.currentIndex())

    def _on_select(self, index) -> None:
        m = self._entry_at(index)
        if m is None:
            return
        self.detail_heading.setText(m.heading)
        self.detail_title.setText(m.script_name)
        self.detail_meta.setText(f"{', '.join(m.characters)} · {m.pairing or ''}")
        self.preview.setPlainText("\n".join(m.characters))

    def _on_open(self, index) -> None:
        m = self._entry_at(index)
        if m:
            fileops.open_external(m.script_path)

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
