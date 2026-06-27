from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QSortFilterProxyModel, QThread
from PySide6.QtGui import QStandardItem, QStandardItemModel
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
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
        self._unreadable_count = 0

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
            self._cell(
                entry.modified.strftime("%Y-%m-%d %H:%M"), entry.modified.timestamp()
            ),
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
            QMessageBox.question(self, "Move file", f"Move '{entry.name}' to:\n{dest}?")
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
