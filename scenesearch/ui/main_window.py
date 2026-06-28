from __future__ import annotations

from pathlib import Path

from PySide6.QtWidgets import QMainWindow, QTabWidget

from ..cache import ScoreCache
from ..settings import Settings
from .finder_tab import FinderTab
from .search_tab import SearchTab


class MainWindow(QMainWindow):
    def __init__(self, settings_path=None, cache_path=None, index_path=None):
        super().__init__()
        self.setWindowTitle("Scene Search")
        self.resize(1000, 700)

        self._settings = Settings(settings_path or Path.home() / ".scenesearch_settings.json")
        self._cache = ScoreCache(cache_path or Path.home() / ".scenesearch_cache.json")
        self._index_path = index_path or Path.home() / ".scenesearch_index.db"

        self.tabs = QTabWidget()
        self.setCentralWidget(self.tabs)

        self.search_tab = SearchTab(self._settings, self._cache)
        self.tabs.addTab(self.search_tab, "Search")

        self.finder_tab = FinderTab(self._settings, self._index_path)
        self.tabs.addTab(self.finder_tab, "Finder")

    def closeEvent(self, event) -> None:  # noqa: N802 (Qt override)
        self.search_tab._persist_roots()
        self.search_tab._persist_ignored()
        self.finder_tab.stop_indexing()
        super().closeEvent(event)
