from __future__ import annotations

from dataclasses import dataclass

from .library import Library, SceneMatch


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


def scene_rows(library: Library, spec: FilterSpec) -> list[SceneMatch]:
    return library.query(spec.min_chars, spec.max_chars, spec.pairing)


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
