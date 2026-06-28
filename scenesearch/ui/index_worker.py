from __future__ import annotations

from PySide6.QtCore import QObject, Signal

from ..library import Library


class IndexWorker(QObject):
    progress = Signal(int, str)   # files indexed so far, current file name
    finished = Signal(int, int)   # total scripts, total scenes
    failed = Signal(str)          # error message

    def __init__(self, index_path, folder):
        super().__init__()
        self._index_path = index_path
        self._folder = folder

    def run(self) -> None:
        # Use a private connection in this thread (sqlite connections are
        # not shareable across threads).
        lib = Library(self._index_path)
        n = 0

        def cb(name: str) -> None:
            nonlocal n
            n += 1
            self.progress.emit(n, name)

        try:
            lib.reindex(self._folder, progress=cb)
            scripts, scenes = lib.script_count(), lib.scene_count()
        except Exception as exc:  # surface to the UI, never crash the thread
            lib.close()
            self.failed.emit(str(exc))
            return
        lib.close()
        self.finished.emit(scripts, scenes)
