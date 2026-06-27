from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from send2trash import send2trash


def _unique_dest(dest_dir, name: str) -> Path:
    dest_dir = Path(dest_dir)
    dest = dest_dir / name
    if not dest.exists():
        return dest
    stem, suffix = Path(name).stem, Path(name).suffix
    i = 1
    while True:
        candidate = dest_dir / f"{stem} ({i}){suffix}"
        if not candidate.exists():
            return candidate
        i += 1


def copy_to(path, dest_dir) -> Path:
    src = Path(path)
    dest = _unique_dest(dest_dir, src.name)
    shutil.copy2(src, dest)
    return dest


def move_to(path, dest_dir) -> Path:
    src = Path(path)
    dest = _unique_dest(dest_dir, src.name)
    shutil.move(str(src), str(dest))
    return dest


def rename(path, new_name: str) -> Path:
    src = Path(path)
    dest = src.with_name(new_name)
    if dest.exists():
        raise FileExistsError(f"{dest} already exists")
    src.rename(dest)
    return dest


def delete_to_trash(path) -> None:
    send2trash(str(path))


def open_external(path) -> None:
    subprocess.run(["open", str(path)], check=False)


def reveal_in_finder(path) -> None:
    subprocess.run(["open", "-R", str(path)], check=False)
