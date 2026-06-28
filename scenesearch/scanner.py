from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Iterator

SCRIPT_EXTENSIONS = {".pdf", ".fountain", ".fdx", ".txt", ".docx"}
_SKIP_DIR_NAMES = {"node_modules", "__pycache__", ".git", "Caches", "Library"}


def default_roots() -> list[Path]:
    home = Path.home()
    candidates = [
        home / "Downloads",
        home / "Desktop",
        home / "Documents",
        home / "Library/Mobile Documents/com~apple~CloudDocs/Documents",
    ]
    return [c for c in candidates if c.is_dir()]


def iter_candidates(roots: Iterable, ignore_dirs: Iterable = None) -> Iterator[Path]:
    ignored = {Path(p).resolve() for p in (ignore_dirs or [])}
    seen: set[Path] = set()
    for root in roots:
        root = Path(root)
        if not root.is_dir():
            continue
        if root.resolve() in ignored:
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d
                for d in dirnames
                if not d.startswith(".")
                and d not in _SKIP_DIR_NAMES
                and not d.endswith(".app")
                and (Path(dirpath) / d).resolve() not in ignored
            ]
            for fname in filenames:
                if fname.startswith("."):
                    continue
                fp = Path(dirpath) / fname
                if fp.suffix.lower() not in SCRIPT_EXTENSIONS:
                    continue
                rp = fp.resolve()
                if rp in seen:
                    continue
                seen.add(rp)
                yield fp
