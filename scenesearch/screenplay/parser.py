from __future__ import annotations

import re
from dataclasses import dataclass, field

_SCENE_RE = re.compile(
    r"^\s*(?:\d+[A-Za-z]?[.)]?\s+)?"  # optional leading scene number (shooting scripts)
    r"(INT\.?/EXT\.?|EXT\.?/INT\.?|INT|EXT|I/E|E/I)[\.\s]",
    re.IGNORECASE,
)
_SCENE_NUM_PREFIX = re.compile(r"^\s*\d+[A-Za-z]?[.)]?\s+")
_TRANSITION_RE = re.compile(
    r"\b(FADE IN|FADE OUT|FADE TO BLACK|CUT TO|SMASH CUT|MATCH CUT|DISSOLVE TO)\b"
)
_CUE_RE = re.compile(r"^[ \t]*[A-Z][A-Z0-9 .'\-]{0,30}(\([^)]*\))?[ \t]*$")
_PAREN_RE = re.compile(r"\([^)]*\)")


@dataclass
class Scene:
    heading: str
    index: int
    page: int
    characters: list[str] = field(default_factory=list)
    lines: list[tuple[str, str]] = field(default_factory=list)


def _normalize_character(text: str) -> str:
    name = _PAREN_RE.sub("", text)
    return " ".join(name.split()).upper()


def _next_nonempty(lines: list[str], start: int) -> str | None:
    for j in range(start, len(lines)):
        if lines[j].strip():
            return lines[j]
    return None


def _is_cue(line: str) -> bool:
    stripped = line.strip()
    if not stripped or _SCENE_RE.match(line) or _TRANSITION_RE.search(stripped):
        return False
    if not _CUE_RE.match(line):
        return False
    name = _normalize_character(stripped)
    if name and name[-1] in ".!?":  # action/sound lines like "THE PHONE RINGS."
        return False
    words = name.split()
    return 1 <= len(words) <= 4 and any(c.isalpha() for c in name)


def parse_scenes(text: str) -> list[Scene]:
    if not text:
        return []
    has_pages = "\f" in text
    lines = text.split("\n")
    scenes: list[Scene] = []
    current: Scene | None = None
    seen: set[str] = set()
    page = 1
    for i, raw in enumerate(lines):
        page += raw.count("\f")
        if _SCENE_RE.match(raw):
            current = Scene(
                heading=" ".join(_SCENE_NUM_PREFIX.sub("", raw).split()),
                index=len(scenes) + 1,
                page=page if has_pages else 0,
            )
            scenes.append(current)
            seen = set()
            continue
        if current is None:
            continue
        if _is_cue(raw):
            nxt = _next_nonempty(lines, i + 1)
            if nxt is None or _SCENE_RE.match(nxt):
                continue
            name = _normalize_character(raw)
            if name not in seen:
                seen.add(name)
                current.characters.append(name)
            # capture the dialogue block (until blank line / next cue / heading)
            said: list[str] = []
            j = i + 1
            while j < len(lines):
                nxt = lines[j]
                if not nxt.strip():
                    break
                if _SCENE_RE.match(nxt) or _is_cue(nxt):
                    break
                said.append(nxt.strip())
                j += 1
            if said:
                current.lines.append((name, " ".join(said)))
    return scenes
