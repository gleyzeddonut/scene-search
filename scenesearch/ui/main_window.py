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
from ..model import ScriptEntry
from ..scanner import default_roots
from ..settings import Settings
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
    def __init__(self, settings_path=None, cache_path=None):
        super().__init__()
        self.setWindowTitle("Scene Search")
        self.resize(1000, 640)

        self._settings = Settings(settings_path or Path.home() / ".scenesearch_settings.json")
        self._cache = ScoreCache(cache_path or Path.home() / ".scenesearch_cache.json")
        self._thread: QThread | None = None
        self._worker: ScanWorker | None = None
        self._unreadable_count = 0

        self._build_ui()
        self._load_roots()
        self._load_ignored()

    def _load_roots(self) -> None:
        saved = self._settings.get_roots()
        roots = saved if saved is not None else [str(r) for r in default_roots()]
        for root in roots:
            self.roots_list.addItem(root)

    def _load_ignored(self) -> None:
        for path in self._settings.get_ignored() or []:
            self.ignore_list.addItem(path)

    # ---------- UI construction ----------
    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)

        # Folders to scan
        layout.addWidget(QLabel("Folders to scan:"))
        roots_row = QHBoxLayout()
        self.roots_list = QListWidget()
        self.roots_list.setMaximumHeight(80)
        roots_row.addWidget(self.roots_list, 1)
        roots_btns = QVBoxLayout()
        add_btn = QPushButton("Add Folder…")
        add_btn.clicked.connect(self._add_folder)
        remove_btn = QPushButton("Remove")
        remove_btn.clicked.connect(self._remove_folder)
        clear_btn = QPushButton("Clear")
        clear_btn.clicked.connect(self._clear_folders)
        roots_btns.addWidget(add_btn)
        roots_btns.addWidget(remove_btn)
        roots_btns.addWidget(clear_btn)
        roots_btns.addStretch(1)
        roots_row.addLayout(roots_btns)
        layout.addLayout(roots_row)

        # Folders to ignore
        layout.addWidget(QLabel("Folders to ignore (skipped during scan):"))
        ignore_row = QHBoxLayout()
        self.ignore_list = QListWidget()
        self.ignore_list.setMaximumHeight(70)
        ignore_row.addWidget(self.ignore_list, 1)
        ignore_btns = QVBoxLayout()
        ignore_add_btn = QPushButton("Ignore Folder…")
        ignore_add_btn.clicked.connect(self._add_ignore)
        ignore_remove_btn = QPushButton("Remove")
        ignore_remove_btn.clicked.connect(self._remove_ignore)
        ignore_clear_btn = QPushButton("Clear")
        ignore_clear_btn.clicked.connect(self._clear_ignore)
        ignore_btns.addWidget(ignore_add_btn)
        ignore_btns.addWidget(ignore_remove_btn)
        ignore_btns.addWidget(ignore_clear_btn)
        ignore_btns.addStretch(1)
        ignore_row.addLayout(ignore_btns)
        layout.addLayout(ignore_row)

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
        self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        # Hide the left-edge row-number gutter; it shows stale scan-order
        # positions that look scrambled once the table is sorted.
        self.table.verticalHeader().setVisible(False)
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
        self._update_actions(0)

    # ---------- Roots ----------
    def _add_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Add folder to scan")
        if folder:
            self.roots_list.addItem(folder)
            self._persist_roots()

    def _remove_folder(self) -> None:
        for item in self.roots_list.selectedItems():
            self.roots_list.takeItem(self.roots_list.row(item))
        self._persist_roots()

    def _clear_folders(self) -> None:
        self.roots_list.clear()
        self._persist_roots()

    def _roots(self) -> list[str]:
        return [self.roots_list.item(i).text() for i in range(self.roots_list.count())]

    def _persist_roots(self) -> None:
        self._settings.set_roots(self._roots())

    # ---------- Ignore folders ----------
    def _add_ignore(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Choose a folder to ignore")
        if folder:
            self.ignore_list.addItem(folder)
            self._persist_ignored()

    def _remove_ignore(self) -> None:
        for item in self.ignore_list.selectedItems():
            self.ignore_list.takeItem(self.ignore_list.row(item))
        self._persist_ignored()

    def _clear_ignore(self) -> None:
        self.ignore_list.clear()
        self._persist_ignored()

    def _ignored(self) -> list[str]:
        return [self.ignore_list.item(i).text() for i in range(self.ignore_list.count())]

    def _persist_ignored(self) -> None:
        self._settings.set_ignored(self._ignored())

    def closeEvent(self, event) -> None:  # noqa: N802 (Qt override)
        self._persist_roots()
        self._persist_ignored()
        super().closeEvent(event)

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
        self._worker = ScanWorker(
            roots, DEFAULT_THRESHOLD, self._cache, self._ignored()
        )
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

    def _selected_source_rows(self) -> list[int]:
        return [
            self.proxy.mapToSource(idx).row()
            for idx in self.table.selectionModel().selectedRows()
        ]

    def _selected_entries(self) -> list:
        return [self.model.item(r, 0).data(_ENTRY_ROLE) for r in self._selected_source_rows()]

    def _selected_entry(self):
        entries = self._selected_entries()
        return entries[0] if entries else None

    def _remove_source_rows(self, rows) -> None:
        for r in sorted(set(rows), reverse=True):
            self.model.removeRow(r)

    def _on_select(self, *args) -> None:
        entries = self._selected_entries()
        self._update_actions(len(entries))
        if not entries:
            self.detail.clear()
            return
        if len(entries) == 1:
            entry = entries[0]
            cues = "\n".join(f"  • {c}" for c in entry.matched_cues) or "  (none)"
            self.detail.setPlainText(
                f"{entry.path}\n\nConfidence: {entry.confidence:.0%}\nMatched cues:\n{cues}"
            )
        else:
            self.detail.setPlainText(
                f"{len(entries)} files selected.\n"
                "Use Move to… or Copy to… (click “New Folder” in the dialog to "
                "create one), or Delete to Trash, to act on all of them at once."
            )

    def _update_actions(self, count: int) -> None:
        many = count >= 1
        for b in (self.open_btn, self.reveal_btn, self.copy_btn, self.move_btn, self.trash_btn):
            b.setEnabled(many)
        # Rename only makes sense for a single file.
        self.rename_btn.setEnabled(count == 1)

    # ---------- Actions ----------
    def _action_open(self) -> None:
        for entry in self._selected_entries():
            fileops.open_external(entry.path)

    def _action_reveal(self) -> None:
        for entry in self._selected_entries():
            fileops.reveal_in_finder(entry.path)

    def _action_rename(self) -> None:
        rows = self._selected_source_rows()
        if len(rows) != 1:
            return
        row = rows[0]
        entry = self.model.item(row, 0).data(_ENTRY_ROLE)
        new_name, ok = QInputDialog.getText(
            self, "Rename", "New file name:", text=entry.name
        )
        if not (ok and new_name and new_name != entry.name):
            return
        try:
            new_path = fileops.rename(entry.path, new_name)
        except Exception as exc:
            QMessageBox.critical(self, "Rename failed", str(exc))
            return
        # Update the row in place so the new name/path stays usable.
        updated = ScriptEntry.from_path(new_path, entry.confidence, entry.matched_cues)
        item = self.model.item(row, 0)
        item.setText(updated.name)
        item.setData(updated.name, _SORT_ROLE)
        item.setData(updated, _ENTRY_ROLE)
        self.status.setText(f"Renamed to {new_name}.")
        self._on_select()

    def _action_copy(self) -> None:
        entries = self._selected_entries()
        if not entries:
            return
        dest = QFileDialog.getExistingDirectory(
            self, "Copy to folder — click “New Folder” to create one"
        )
        if not dest:
            return
        copied, errors = 0, []
        for entry in entries:
            try:
                fileops.copy_to(entry.path, dest)
                copied += 1
            except Exception as exc:
                errors.append(f"{entry.name}: {exc}")
        if errors:
            QMessageBox.warning(self, "Some copies failed", "\n".join(errors))
        self.status.setText(f"Copied {copied} file(s) to {dest}.")

    def _action_move(self) -> None:
        rows = self._selected_source_rows()
        entries = [self.model.item(r, 0).data(_ENTRY_ROLE) for r in rows]
        if not entries:
            return
        dest = QFileDialog.getExistingDirectory(
            self, "Move to folder — click “New Folder” to create one"
        )
        if not dest:
            return
        if (
            QMessageBox.question(
                self, "Move files", f"Move {len(entries)} file(s) to:\n{dest}?"
            )
            != QMessageBox.Yes
        ):
            return
        done_rows, errors = [], []
        for row, entry in zip(rows, entries):
            try:
                fileops.move_to(entry.path, dest)
                done_rows.append(row)
            except Exception as exc:
                errors.append(f"{entry.name}: {exc}")
        self._remove_source_rows(done_rows)
        if errors:
            QMessageBox.warning(self, "Some moves failed", "\n".join(errors))
        self.status.setText(f"Moved {len(done_rows)} file(s) to {dest}.")

    def _action_trash(self) -> None:
        rows = self._selected_source_rows()
        entries = [self.model.item(r, 0).data(_ENTRY_ROLE) for r in rows]
        if not entries:
            return
        if (
            QMessageBox.question(
                self, "Delete to Trash", f"Move {len(entries)} file(s) to the Trash?"
            )
            != QMessageBox.Yes
        ):
            return
        done_rows, errors = [], []
        for row, entry in zip(rows, entries):
            try:
                fileops.delete_to_trash(entry.path)
                done_rows.append(row)
            except Exception as exc:
                errors.append(f"{entry.name}: {exc}")
        self._remove_source_rows(done_rows)
        if errors:
            QMessageBox.warning(self, "Some deletes failed", "\n".join(errors))
        self.status.setText(f"Moved {len(done_rows)} file(s) to Trash.")
