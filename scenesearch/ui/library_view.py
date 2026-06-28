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
