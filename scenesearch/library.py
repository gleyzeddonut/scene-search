from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from .extractors import ExtractionError, extract_paginated
from .scanner import iter_candidates
from .screenplay.gender import scene_pairing
from .screenplay.parser import parse_scenes
from .screenplay.runtime import estimate_seconds, scene_word_count

# bump when the parser or scene schema changes so a re-index re-parses every
# file (not just changed ones) after an app upgrade
INDEX_VERSION = 2

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scripts(
    path TEXT PRIMARY KEY, name TEXT, mtime REAL, scene_count INTEGER);
CREATE TABLE IF NOT EXISTS scenes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    script_path TEXT, scene_index INTEGER, heading TEXT, page INTEGER,
    char_count INTEGER, characters_json TEXT, pairing TEXT,
    dialogue_json TEXT, est_seconds INTEGER);
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
    scene_index: int = 0
    est_seconds: int = 0


class Library:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.executescript(_SCHEMA)
        # migrate older dbs that predate the dialogue/runtime columns
        for col, typ in (("dialogue_json", "TEXT"), ("est_seconds", "INTEGER")):
            try:
                self._conn.execute(f"ALTER TABLE scenes ADD COLUMN {col} {typ}")
            except sqlite3.OperationalError:
                pass
        self._stored_version = self._conn.execute("PRAGMA user_version").fetchone()[0]

    def close(self) -> None:
        self._conn.close()

    def reindex(self, folders, ignore_dirs=None, progress=None, should_cancel=None,
                on_error=None) -> None:
        # accept a single folder or a list; scan ALL of them
        if isinstance(folders, (str, Path)):
            folders = [folders]
        # after an app upgrade the parser/schema may have changed — re-parse
        # every file once (ignoring mtime) so old entries get refreshed.
        full = self._stored_version < INDEX_VERSION
        present: set[str] = set()
        for path in iter_candidates(folders, ignore_dirs, should_cancel=should_cancel,
                                    on_error=on_error):
            if should_cancel and should_cancel():
                break
            present.add(str(path.resolve()))
            self._index_file(path, full=full)
            if progress:  # report every file examined, not just (re)parsed ones
                progress(path.name)
        if should_cancel and should_cancel():
            # cancelled (possibly during the walk, before any file was yielded):
            # keep what we indexed so far; don't prune or bump version
            self._conn.commit()
            return
        for (stored,) in self._conn.execute("SELECT path FROM scripts").fetchall():
            if stored not in present:
                self._delete_script(stored)
        self._conn.execute(f"PRAGMA user_version = {INDEX_VERSION}")
        self._stored_version = INDEX_VERSION
        self._conn.commit()

    def _index_file(self, path, full=False) -> None:
        rp = str(path.resolve())
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return
        if not full:
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
            words = scene_word_count(s.lines)
            self._conn.execute(
                "INSERT INTO scenes(script_path, scene_index, heading, page, "
                "char_count, characters_json, pairing, dialogue_json, est_seconds) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (rp, s.index, s.heading, s.page, len(s.characters),
                 json.dumps(s.characters), scene_pairing(s.characters),
                 json.dumps(s.lines), estimate_seconds(words)),
            )

    def _delete_script(self, rp: str) -> None:
        self._conn.execute("DELETE FROM scenes WHERE script_path=?", (rp,))
        self._conn.execute("DELETE FROM scripts WHERE path=?", (rp,))

    def remove_script(self, path) -> None:
        """Drop one script (by its stored path) from the index and commit."""
        self._delete_script(str(path))
        self._conn.commit()

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
            "s.characters_json, s.pairing, s.scene_index, s.est_seconds FROM scenes s "
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
        for path, name, heading, page, cc, cj, pr, sidx, est in self._conn.execute(sql, args):
            out.append(SceneMatch(path, name, heading, page, cc, json.loads(cj), pr,
                                  sidx, est or 0))
        return out

    def get_scene(self, path, scene_index):
        row = self._conn.execute(
            "SELECT heading, characters_json, dialogue_json, est_seconds "
            "FROM scenes WHERE script_path=? AND scene_index=?",
            (str(path), scene_index)).fetchone()
        if row is None:
            return None
        heading, chars, dlg, est = row
        return {"heading": heading, "characters": json.loads(chars),
                "lines": [{"who": w, "text": t} for w, t in json.loads(dlg or "[]")],
                "est_seconds": est or 0}
