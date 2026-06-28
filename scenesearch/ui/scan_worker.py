from __future__ import annotations

from PySide6.QtCore import QObject, Signal

from ..pipeline import FoundEvent, ProgressEvent, UnreadableEvent, scan_for_scripts


class ScanWorker(QObject):
    found = Signal(object)         # ScriptEntry
    unreadable = Signal(str, str)  # path, reason
    progress = Signal(int, str)    # scanned, current path
    finished = Signal(int, int)    # total_found, total_unreadable

    def __init__(self, roots, threshold, cache=None, ignore_dirs=None):
        super().__init__()
        self._roots = roots
        self._threshold = threshold
        self._cache = cache
        self._ignore_dirs = ignore_dirs
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    def run(self) -> None:
        found_n = 0
        unreadable_n = 0
        for event in scan_for_scripts(
            self._roots, self._threshold, self._cache, self._ignore_dirs
        ):
            if self._cancelled:
                break
            if isinstance(event, FoundEvent):
                found_n += 1
                self.found.emit(event.entry)
            elif isinstance(event, UnreadableEvent):
                unreadable_n += 1
                self.unreadable.emit(str(event.path), event.reason)
            elif isinstance(event, ProgressEvent):
                self.progress.emit(event.scanned, str(event.current))
        if self._cache is not None:
            self._cache.save()
        self.finished.emit(found_n, unreadable_n)
