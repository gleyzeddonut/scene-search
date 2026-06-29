from __future__ import annotations

import re
from dataclasses import dataclass, field

from .library import Library, SceneMatch

_PAREN_NUM_RE = re.compile(r"\s*\(\d+\)$")
_COPY_RE = re.compile(r"\s+copy(\s+\d+)?$", re.IGNORECASE)


@dataclass
class FilterSpec:
    min_chars: int | None = None
    max_chars: int | None = None
    pairing: str | None = None


@dataclass
class ScriptMatch:
    script_path: str
    script_name: str
    match_count: int


@dataclass
class ScriptGroup:
    canonical_name: str
    members: list[ScriptMatch] = field(default_factory=list)

    @property
    def total_match_count(self) -> int:
        return sum(m.match_count for m in self.members)


def canonical_key(filename: str) -> str:
    """Collapse re-download copies to one key: 'Heat (1).pdf', 'Heat copy.pdf'
    -> 'heat.pdf'."""
    parts = filename.rsplit(".", 1)
    stem = parts[0]
    ext = f".{parts[1]}" if len(parts) == 2 else ""
    prev = None
    while prev != stem:
        prev = stem
        stem = _PAREN_NUM_RE.sub("", stem)
        stem = _COPY_RE.sub("", stem)
    return (stem.strip() + ext).lower()


def group_duplicates(rows: list[ScriptMatch]) -> list[ScriptGroup]:
    groups: dict[str, list[ScriptMatch]] = {}
    order: list[str] = []
    for m in rows:
        key = canonical_key(m.script_name)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(m)
    out: list[ScriptGroup] = []
    for key in order:
        members = groups[key]
        display = min(members, key=lambda x: len(x.script_name)).script_name
        out.append(ScriptGroup(display, members))
    return out


def scene_rows(library: Library, spec: FilterSpec) -> list[SceneMatch]:
    rows = library.query(spec.min_chars, spec.max_chars, spec.pairing)
    # fold re-download copies: keep scenes from one representative per canonical
    # name (the shortest filename — i.e. the original, not "… (1)")
    rep: dict[str, str] = {}
    rep_name: dict[str, str] = {}
    for m in rows:
        key = canonical_key(m.script_name)
        if key not in rep_name or len(m.script_name) < len(rep_name[key]):
            rep[key] = m.script_path
            rep_name[key] = m.script_name
    return [m for m in rows if rep[canonical_key(m.script_name)] == m.script_path]


def script_rows(library: Library, spec: FilterSpec) -> list[ScriptMatch]:
    names: dict[str, str] = {}
    counts: dict[str, int] = {}
    order: list[str] = []
    for m in scene_rows(library, spec):
        if m.script_path not in counts:
            order.append(m.script_path)
            counts[m.script_path] = 0
            names[m.script_path] = m.script_name
        counts[m.script_path] += 1
    return [ScriptMatch(p, names[p], counts[p]) for p in order]
