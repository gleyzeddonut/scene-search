from __future__ import annotations

import json
from pathlib import Path


class Settings:
    """Tiny JSON-backed settings store. Currently just the scan-folder list."""

    def __init__(self, path):
        self.path = Path(path)
        self._data: dict = {}
        self.load()

    def load(self) -> None:
        if self.path.is_file():
            try:
                self._data = json.loads(self.path.read_text())
            except Exception:
                self._data = {}

    def save(self) -> None:
        self.path.write_text(json.dumps(self._data))

    def get_roots(self) -> list[str] | None:
        """Saved roots, or None if the user has never set them (first launch)."""
        return self._get_list("roots")

    def set_roots(self, roots) -> None:
        self._set_list("roots", roots)

    def get_ignored(self) -> list[str] | None:
        """Saved ignore folders, or None if the user has never set them."""
        return self._get_list("ignored")

    def set_ignored(self, paths) -> None:
        self._set_list("ignored", paths)

    def get_library(self) -> str | None:
        value = self._data.get("library")
        return str(value) if isinstance(value, str) else None

    def set_library(self, path) -> None:
        self._data["library"] = str(path)
        self.save()

    def _get_list(self, key: str) -> list[str] | None:
        value = self._data.get(key)
        return [str(v) for v in value] if isinstance(value, list) else None

    def _set_list(self, key: str, values) -> None:
        self._data[key] = [str(v) for v in values]
        self.save()
