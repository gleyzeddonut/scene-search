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
