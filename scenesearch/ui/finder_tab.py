from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QThread
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
    QProgressBar,
    QPushButton,
    QRadioButton,
    QSpinBox,
    QTreeView,
    QVBoxLayout,
    QWidget,
)

from ..finder import FilterSpec, group_duplicates, scene_rows, script_rows
from ..library import Library
from .. import fileops
from .index_worker import IndexWorker

_PAIRINGS = [
    ("Any", None),
    ("Man + Woman", "MW"),
    ("Man + Man", "MM"),
    ("Woman + Woman", "WW"),
    ("Has unknown gender", "has_unknown"),
]
_PATH_ROLE = Qt.UserRole + 1
_MEMBERS_ROLE = Qt.UserRole + 2
_PAIR_PRETTY = {None: "", "MW": "M+W", "MM": "M+M", "WW": "W+W", "has_unknown": "?"}


class FinderTab(QWidget):
    def __init__(self, settings, index_path):
        super().__init__()
        self._settings = settings
        self._index_path = index_path
        self._library = Library(index_path)
        self._index_thread: QThread | None = None
        self._index_worker: IndexWorker | None = None
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

        self.progress = QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.setVisible(False)
        layout.addWidget(self.progress)
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
        self.delete_btn = QPushButton("Delete to Trash")
        self.delete_btn.clicked.connect(self._delete_selected)
        view_row.addWidget(self.delete_btn)
        layout.addLayout(view_row)

        self.model = QStandardItemModel()
        self.tree = QTreeView()
        self.tree.setModel(self.model)
        self.tree.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.tree.setRootIsDecorated(True)
        self.tree.doubleClicked.connect(self._open_selected)
        layout.addWidget(self.tree, 1)

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
        self.progress.setVisible(True)
        self.status.setText("Indexing… (starting)")

        self._index_thread = QThread()
        self._index_worker = IndexWorker(self._index_path, folder)
        self._index_worker.moveToThread(self._index_thread)
        self._index_thread.started.connect(self._index_worker.run)
        self._index_worker.progress.connect(self._on_index_progress)
        self._index_worker.finished.connect(self._on_index_finished)
        self._index_worker.failed.connect(self._on_index_failed)
        self._index_worker.finished.connect(self._index_thread.quit)
        self._index_worker.failed.connect(self._index_thread.quit)
        # Clean teardown: stop and delete the thread/worker once it's done so a
        # finished thread is never destroyed while still "running".
        self._index_thread.finished.connect(self._index_worker.deleteLater)
        self._index_thread.finished.connect(self._index_thread.deleteLater)
        self._index_thread.finished.connect(self._clear_index_refs)
        self._index_thread.start()

    def _clear_index_refs(self) -> None:
        self._index_thread = None
        self._index_worker = None

    def stop_indexing(self) -> None:
        """Block until any running index thread has finished (used on app close)."""
        if self._index_thread is not None and self._index_thread.isRunning():
            self._index_thread.quit()
            self._index_thread.wait(5000)

    def _on_index_progress(self, count: int, name: str) -> None:
        self.status.setText(f"Indexing… {count} files ({name})")

    def _end_index(self) -> None:
        self.progress.setVisible(False)
        self.index_btn.setEnabled(True)

    def _on_index_finished(self, scripts: int, scenes: int) -> None:
        self._end_index()
        self.status.setText(f"Indexed: {scripts} scripts, {scenes} scenes.")
        self._run_filter()

    def _on_index_failed(self, message: str) -> None:
        self._end_index()
        QMessageBox.critical(self, "Indexing failed", message)
        self._refresh_status()

    def _refresh_status(self) -> None:
        if self._library.is_indexed():
            self.status.setText(
                f"Indexed: {self._library.script_count()} scripts, "
                f"{self._library.scene_count()} scenes."
            )
        else:
            self.status.setText("Not indexed yet — choose a folder and click Index.")

    # ---------- Filtering / views ----------
    def _spec(self) -> FilterSpec:
        return FilterSpec(
            min_chars=self.min_spin.value(),
            max_chars=self.max_spin.value(),
            pairing=_PAIRINGS[self.pairing_combo.currentIndex()][1],
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
        for m in rows:
            self.model.appendRow([
                self._cell(m.script_name, path=m.script_path),
                self._cell(m.heading),
                self._cell(str(m.page) if m.page else "—"),
                self._cell(str(m.char_count)),
                self._cell(", ".join(m.characters)),
                self._cell(_PAIR_PRETTY.get(m.pairing, "")),
            ])
        self._fit()

    def _show_scripts(self, rows) -> None:
        self.model.clear()
        self.model.setHorizontalHeaderLabels(["Script", "Matching scenes"])
        for grp in group_duplicates(rows):
            if len(grp.members) == 1:
                m = grp.members[0]
                self.model.appendRow(
                    [self._cell(grp.canonical_name, path=m.script_path),
                     self._cell(str(m.match_count))]
                )
            else:
                parent = self._cell(
                    f"{grp.canonical_name}  ({len(grp.members)} copies)",
                    members=[m.script_path for m in grp.members],
                )
                count_cell = self._cell(
                    f"{grp.total_match_count} scenes across {len(grp.members)} files"
                )
                self.model.appendRow([parent, count_cell])
                for m in grp.members:
                    parent.appendRow(
                        [self._cell(m.script_name, path=m.script_path),
                         self._cell(str(m.match_count))]
                    )
        self._fit()

    @staticmethod
    def _cell(text, path=None, members=None) -> QStandardItem:
        item = QStandardItem(text)
        item.setEditable(False)
        if path is not None:
            item.setData(path, _PATH_ROLE)
        if members is not None:
            item.setData(members, _MEMBERS_ROLE)
        return item

    def _fit(self) -> None:
        self.tree.header().setSectionResizeMode(0, QHeaderView.Stretch)

    # ---------- Open / delete ----------
    def _col0(self, index):
        if not index.isValid():
            return None
        return self.model.itemFromIndex(index.siblingAtColumn(0))

    def _open_selected(self, index) -> None:
        item = self._col0(index)
        if item is None:
            return
        path = item.data(_PATH_ROLE)
        if path:
            fileops.open_external(path)
        # stack parents (no path) fall through to the tree's default expand

    def _delete_selected(self) -> None:
        item = self._col0(self.tree.currentIndex())
        if item is None:
            QMessageBox.information(self, "Nothing selected", "Select a script first.")
            return
        members = item.data(_MEMBERS_ROLE)
        path = item.data(_PATH_ROLE)
        if members:  # a folded stack
            self._delete_stack(members)
        elif path is not None:
            parent = item.parent()
            stack = parent.data(_MEMBERS_ROLE) if parent is not None else None
            if stack:  # a single version inside a stack
                self._delete_version(path, stack)
            else:  # a standalone script (or a scene row)
                self._delete_single(path)

    def _delete_single(self, path) -> None:
        if (
            QMessageBox.question(
                self, "Delete to Trash", f"Move '{Path(path).name}' to the Trash?"
            )
            == QMessageBox.Yes
        ):
            self._do_delete([path])

    def _delete_stack(self, members) -> None:
        if (
            QMessageBox.question(
                self,
                "Delete all copies",
                f"Delete all {len(members)} copies of this script to the Trash?",
            )
            == QMessageBox.Yes
        ):
            self._do_delete(members)

    def _delete_version(self, path, stack) -> None:
        box = QMessageBox(self)
        box.setWindowTitle("Delete script")
        box.setText(f"'{Path(path).name}' is one of {len(stack)} copies of this script.")
        box.setInformativeText("Delete just this file, or the whole stack?")
        just_btn = box.addButton("Just this file", QMessageBox.AcceptRole)
        all_btn = box.addButton(f"All {len(stack)} copies", QMessageBox.DestructiveRole)
        box.addButton("Cancel", QMessageBox.RejectRole)
        box.exec()
        clicked = box.clickedButton()
        if clicked is just_btn:
            self._do_delete([path])
        elif clicked is all_btn:
            self._do_delete(stack)

    def _do_delete(self, paths) -> None:
        errors = []
        for p in paths:
            try:
                fileops.delete_to_trash(p)
                self._library.remove_script(p)
            except Exception as exc:
                errors.append(f"{Path(p).name}: {exc}")
        if errors:
            QMessageBox.warning(self, "Some deletes failed", "\n".join(errors))
        self._refresh_status()
        self._run_filter()
