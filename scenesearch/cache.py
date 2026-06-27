from __future__ import annotations

import json
from pathlib import Path


class ScoreCache:
    def __init__(self, path):
        self.path = Path(path)
        self._data: dict[str, dict] = {}
        self.load()

    def load(self) -> None:
        if self.path.is_file():
            try:
                self._data = json.loads(self.path.read_text())
            except Exception:
                self._data = {}

    def save(self) -> None:
        self.path.write_text(json.dumps(self._data))

    @staticmethod
    def _key(path, mtime: float, size: int) -> str:
        return f"{Path(path).resolve()}|{int(mtime)}|{int(size)}"

    def get(self, path, mtime: float, size: int):
        return self._data.get(self._key(path, mtime, size))

    def put(self, path, mtime: float, size: int, confidence: float, cues) -> None:
        self._data[self._key(path, mtime, size)] = {
            "confidence": confidence,
            "cues": list(cues),
        }
