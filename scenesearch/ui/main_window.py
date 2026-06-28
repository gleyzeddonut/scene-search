from __future__ import annotations

import os
import subprocess
from pathlib import Path

from PySide6.QtCore import Qt, QThread, QUrl
from PySide6.QtGui import QAction, QDesktopServices, QKeySequence
from PySide6.QtWidgets import (
    QLabel,
    QMainWindow,
    QMessageBox,
    QVBoxLayout,
    QWidget,
)

from ..cache import ScoreCache
from ..library import Library
from ..settings import Settings
from ..updater import is_translocated, running_app_bundle, write_swap_script
from ..version import __version__
from .app_shell import AppShell, load_app_fonts
from .browse_view import BrowseView
from .library_view import LibraryView
from .settings_dialog import SettingsDialog
from .update_banner import UpdateBanner
from .update_worker import CheckWorker, DownloadWorker

HELP_URL = "https://github.com/gleyzeddonut/scene-search"


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
        self._manual_check = False
        self._dl_thread: QThread | None = None
        self._dl_worker = None

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.update_banner = UpdateBanner()
        self.update_banner.action_button.clicked.connect(self._on_banner_action)
        layout.addWidget(self.update_banner)

        load_app_fonts()
        self._library = Library(self._index_path)
        self.shell = AppShell(self._settings)
        layout.addWidget(self.shell, 1)
        self.setCentralWidget(container)

        self.browse_view = BrowseView(self._settings, self._library)
        self.library_view = LibraryView(self._settings, self._library, self._index_path)
        prepare_placeholder = QLabel("Select a scene in Browse, then “Prepare scene →”.")
        prepare_placeholder.setObjectName("muted")
        prepare_placeholder.setAlignment(Qt.AlignCenter)

        self.shell.add_view("browse", self.browse_view, "Browse", "browse")
        self.shell.add_view("prepare", prepare_placeholder, "Prepare", "prepare")
        self.shell.add_view("library", self.library_view, "Library", "library")
        self.shell.searchChanged.connect(self.browse_view.set_search)
        self.shell.themeChanged.connect(self.browse_view.refresh)
        self.browse_view.prepareRequested.connect(lambda _m: self.shell.show_view("prepare"))

        self._build_menus()
        if self._settings.get_check_updates():
            self._start_update_check()

    # ---------- Menus ----------
    def _build_menus(self) -> None:
        menubar = self.menuBar()
        help_menu = menubar.addMenu("Help")

        # PreferencesRole/AboutRole get relocated to the macOS app menu.
        settings_action = QAction("Settings…", self)
        settings_action.setMenuRole(QAction.MenuRole.PreferencesRole)
        settings_action.setShortcut(QKeySequence.StandardKey.Preferences)  # ⌘,
        settings_action.triggered.connect(self._open_settings)
        help_menu.addAction(settings_action)

        about_action = QAction("About Scripty", self)
        about_action.setMenuRole(QAction.MenuRole.AboutRole)
        about_action.triggered.connect(self._show_about)
        help_menu.addAction(about_action)

        help_action = QAction("Scripty Help", self)
        help_action.setMenuRole(QAction.MenuRole.ApplicationSpecificRole)
        help_action.triggered.connect(lambda: QDesktopServices.openUrl(QUrl(HELP_URL)))
        help_menu.addAction(help_action)

        check_action = QAction("Check for Updates…", self)
        check_action.setMenuRole(QAction.MenuRole.ApplicationSpecificRole)
        check_action.triggered.connect(self._manual_update_check)
        help_menu.addAction(check_action)

    def _open_settings(self) -> None:
        SettingsDialog(self._settings, self).exec()

    def _show_about(self) -> None:
        QMessageBox.about(
            self,
            "About Scripty",
            f"<b>Scripty</b><br>Version {__version__}<br><br>"
            "Find, browse, and prepare movie scripts on your Mac.",
        )

    def _manual_update_check(self) -> None:
        self._start_update_check(manual=True)

    # ---------- Update check ----------
    def _start_update_check(self, manual: bool = False) -> None:
        if self._update_thread is not None:
            return  # a check is already running
        self._manual_check = manual
        self._update_thread = QThread()
        self._update_worker = CheckWorker()
        self._update_worker.moveToThread(self._update_thread)
        self._update_thread.started.connect(self._update_worker.run)
        self._update_worker.update_available.connect(self._on_update_available)
        self._update_worker.no_update.connect(self._on_no_update)
        self._update_worker.update_available.connect(self._update_thread.quit)
        self._update_worker.no_update.connect(self._update_thread.quit)
        self._update_thread.finished.connect(self._update_worker.deleteLater)
        self._update_thread.finished.connect(self._update_thread.deleteLater)
        self._update_thread.finished.connect(self._clear_update_thread)
        self._update_thread.start()

    def _clear_update_thread(self) -> None:
        self._update_thread = None
        self._update_worker = None

    def _on_no_update(self) -> None:
        if self._manual_check:
            QMessageBox.information(
                self,
                "Up to date",
                f"You're on the latest version (v{__version__}).",
            )

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

    @staticmethod
    def _stop_thread(thread) -> None:
        # Network workers run a single blocking run(); quit() takes effect once
        # run() returns (bounded by the socket timeouts in updater.py). Waiting
        # here avoids "QThread destroyed while still running" on quit.
        if thread is not None and thread.isRunning():
            thread.quit()
            thread.wait(31000)

    def closeEvent(self, event) -> None:  # noqa: N802 (Qt override)
        self.library_view._persist()
        self.library_view.stop_indexing()
        self._stop_thread(self._update_thread)
        self._stop_thread(self._dl_thread)
        super().closeEvent(event)
