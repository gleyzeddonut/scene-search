from __future__ import annotations

import os
import subprocess
from pathlib import Path

from PySide6.QtCore import QThread
from PySide6.QtWidgets import QMainWindow, QTabWidget, QVBoxLayout, QWidget

from ..cache import ScoreCache
from ..settings import Settings
from ..updater import is_translocated, running_app_bundle, write_swap_script
from .finder_tab import FinderTab
from .search_tab import SearchTab
from .update_banner import UpdateBanner
from .update_worker import CheckWorker, DownloadWorker


class MainWindow(QMainWindow):
    def __init__(self, settings_path=None, cache_path=None, index_path=None):
        super().__init__()
        self.setWindowTitle("Scene Search")
        self.resize(1000, 700)

        self._settings = Settings(settings_path or Path.home() / ".scenesearch_settings.json")
        self._cache = ScoreCache(cache_path or Path.home() / ".scenesearch_cache.json")
        self._index_path = index_path or Path.home() / ".scenesearch_index.db"

        self._update_info = None
        self._staged_app = None
        self._update_thread: QThread | None = None
        self._update_worker = None
        self._dl_thread: QThread | None = None
        self._dl_worker = None

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.update_banner = UpdateBanner()
        self.update_banner.action_button.clicked.connect(self._on_banner_action)
        layout.addWidget(self.update_banner)

        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)
        self.setCentralWidget(container)

        self.search_tab = SearchTab(self._settings, self._cache)
        self.tabs.addTab(self.search_tab, "Search")
        self.finder_tab = FinderTab(self._settings, self._index_path)
        self.tabs.addTab(self.finder_tab, "Finder")

        self._start_update_check()

    # ---------- Update check ----------
    def _start_update_check(self) -> None:
        self._update_thread = QThread()
        self._update_worker = CheckWorker()
        self._update_worker.moveToThread(self._update_thread)
        self._update_thread.started.connect(self._update_worker.run)
        self._update_worker.update_available.connect(self._on_update_available)
        self._update_worker.update_available.connect(self._update_thread.quit)
        self._update_worker.no_update.connect(self._update_thread.quit)
        self._update_thread.finished.connect(self._update_worker.deleteLater)
        self._update_thread.finished.connect(self._update_thread.deleteLater)
        self._update_thread.finished.connect(self._clear_update_thread)
        self._update_thread.start()

    def _clear_update_thread(self) -> None:
        self._update_thread = None
        self._update_worker = None

    def _on_update_available(self, info) -> None:
        self._update_info = info
        bundle = running_app_bundle()
        if bundle is None:
            self.update_banner.show_message(
                f"Update available: v{info.version} (updates apply to the installed app)."
            )
        elif is_translocated(bundle):
            self.update_banner.show_message(
                "Update available — move Scene Search to your Applications folder to enable updates."
            )
        else:
            self.update_banner.show_available(info.version)

    # ---------- Banner action (Update / Relaunch) ----------
    def _on_banner_action(self) -> None:
        if self._staged_app is not None:
            self._relaunch_with_update()
        elif self._update_info is not None:
            self._start_download()

    def _start_download(self) -> None:
        self.update_banner.show_downloading(0)
        self._dl_thread = QThread()
        self._dl_worker = DownloadWorker(self._update_info.url)
        self._dl_worker.moveToThread(self._dl_thread)
        self._dl_thread.started.connect(self._dl_worker.run)
        self._dl_worker.progress.connect(self.update_banner.show_downloading)
        self._dl_worker.ready.connect(self._on_download_ready)
        self._dl_worker.failed.connect(self._on_download_failed)
        self._dl_worker.ready.connect(self._dl_thread.quit)
        self._dl_worker.failed.connect(self._dl_thread.quit)
        self._dl_thread.finished.connect(self._dl_worker.deleteLater)
        self._dl_thread.finished.connect(self._dl_thread.deleteLater)
        self._dl_thread.start()

    def _on_download_ready(self, app_path: str) -> None:
        self._staged_app = app_path
        self.update_banner.show_ready()

    def _on_download_failed(self, message: str) -> None:
        self._staged_app = None
        self.update_banner.show_message(f"Update failed: {message}")
        if self._update_info is not None:
            self.update_banner.show_available(self._update_info.version)

    def _relaunch_with_update(self) -> None:
        bundle = running_app_bundle()
        if bundle is None or self._staged_app is None:
            return
        script = write_swap_script(bundle, self._staged_app, os.getpid())
        subprocess.Popen(["/bin/bash", str(script)], start_new_session=True)
        from PySide6.QtWidgets import QApplication

        QApplication.quit()

    def closeEvent(self, event) -> None:  # noqa: N802 (Qt override)
        self.search_tab._persist_roots()
        self.search_tab._persist_ignored()
        self.finder_tab.stop_indexing()
        super().closeEvent(event)
