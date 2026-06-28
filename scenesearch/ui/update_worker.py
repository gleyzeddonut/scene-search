from __future__ import annotations

import tempfile
from pathlib import Path

from PySide6.QtCore import QObject, Signal

from ..updater import (
    TEAM_ID,
    check_for_update,
    download,
    unzip_app,
    verify_bundle,
)


class CheckWorker(QObject):
    update_available = Signal(object)  # UpdateInfo
    no_update = Signal()

    def run(self) -> None:
        info = check_for_update()
        if info is not None:
            self.update_available.emit(info)
        else:
            self.no_update.emit()


class DownloadWorker(QObject):
    progress = Signal(int)
    ready = Signal(str)   # staged .app path
    failed = Signal(str)

    def __init__(self, url: str):
        super().__init__()
        self._url = url

    def run(self) -> None:
        try:
            staging = Path(tempfile.mkdtemp(prefix="scenesearch-update-"))
            zip_path = staging / "update.zip"
            download(self._url, zip_path, progress=self.progress.emit)
            app = unzip_app(zip_path, staging)
            if app is None:
                self.failed.emit("Downloaded file did not contain the app.")
                return
            if not verify_bundle(app, TEAM_ID):
                self.failed.emit("Downloaded app failed signature verification.")
                return
            self.ready.emit(str(app))
        except Exception as exc:
            self.failed.emit(str(exc))
