from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from .extractors import ExtractionError, extract_paginated
from .scanner import iter_candidates
from .screenplay.gender import scene_pairing
from .screenplay.parser import parse_scenes

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scripts(
    path TEXT PRIMARY KEY, name TEXT, mtime REAL, scene_count INTEGER);
CREATE TABLE IF NOT EXISTS scenes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    script_path TEXT, scene_index INTEGER, heading TEXT, page INTEGER,
    char_count INTEGER, characters_json TEXT, pairing TEXT);
CREATE INDEX IF NOT EXISTS idx_scenes_script ON scenes(script_path);
"""


@dataclass
class SceneMatch:
    script_path: str
    script_name: str
    heading: str
    page: int
    char_count: int
    characters: list[str] = field(default_factory=list)
    pairing: str | None = None


class Library:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        self._conn.close()

    def reindex(self, folder, progress=None) -> None:
        present: set[str] = set()
        for path in iter_candidates([folder]):
            present.add(str(path.resolve()))
            self._index_file(path, progress)
        for (stored,) in self._conn.execute("SELECT path FROM scripts").fetchall():
            if stored not in present:
                self._delete_script(stored)
        self._conn.commit()

    def _index_file(self, path, progress) -> None:
        rp = str(path.resolve())
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return
        row = self._conn.execute("SELECT mtime FROM scripts WHERE path=?", (rp,)).fetchone()
        if row and abs(row[0] - mtime) < 1e-6:
            return
        try:
            text = extract_paginated(path)
        except ExtractionError:
            text = ""
        scenes = parse_scenes(text)
        self._delete_script(rp)
        self._conn.execute(
            "INSERT INTO scripts(path, name, mtime, scene_count) VALUES(?,?,?,?)",
            (rp, path.name, mtime, len(scenes)),
        )
        for s in scenes:
            self._conn.execute(
                "INSERT INTO scenes(script_path, scene_index, heading, page, "
                "char_count, characters_json, pairing) VALUES(?,?,?,?,?,?,?)",
                (rp, s.index, s.heading, s.page, len(s.characters),
                 json.dumps(s.characters), scene_pairing(s.characters)),
            )
        if progress:
            progress(path.name)

    def _delete_script(self, rp: str) -> None:
        self._conn.execute("DELETE FROM scenes WHERE script_path=?", (rp,))
        self._conn.execute("DELETE FROM scripts WHERE path=?", (rp,))

    def script_count(self) -> int:
        # Only count files that actually parsed into scenes — a grocery list
        # or unreadable PDF (0 scenes) should not inflate "N scripts indexed".
        return self._conn.execute(
            "SELECT COUNT(*) FROM scripts WHERE scene_count > 0"
        ).fetchone()[0]

    def scene_count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM scenes").fetchone()[0]

    def is_indexed(self) -> bool:
        return self.script_count() > 0

    def query(self, min_chars=None, max_chars=None, pairing=None) -> list[SceneMatch]:
        sql = (
            "SELECT sc.path, sc.name, s.heading, s.page, s.char_count, "
            "s.characters_json, s.pairing FROM scenes s "
            "JOIN scripts sc ON sc.path = s.script_path WHERE 1=1"
        )
        args: list = []
        if min_chars is not None:
            sql += " AND s.char_count >= ?"
            args.append(min_chars)
        if max_chars is not None:
            sql += " AND s.char_count <= ?"
            args.append(max_chars)
        if pairing is not None:
            sql += " AND s.pairing = ?"
            args.append(pairing)
        sql += " ORDER BY sc.name, s.scene_index"
        out: list[SceneMatch] = []
        for path, name, heading, page, cc, cj, pr in self._conn.execute(sql, args):
            out.append(SceneMatch(path, name, heading, page, cc, json.loads(cj), pr))
        return out
