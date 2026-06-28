from __future__ import annotations

import re

DEFAULT_THRESHOLD = 0.35

_SCENE_RE = re.compile(
    r"^\s*(INT\.?/EXT\.?|EXT\.?/INT\.?|INT|EXT|I/E|E/I)[\.\s]",
    re.IGNORECASE | re.MULTILINE,
)
_TRANSITION_RE = re.compile(
    r"\b(FADE IN|FADE OUT|FADE TO BLACK|CUT TO|SMASH CUT|MATCH CUT|DISSOLVE TO)\b"
)
_TITLE_RE = re.compile(
    r"\b(written by|screenplay by|story by|teleplay by)\b", re.IGNORECASE
)
_CHAR_CUE_RE = re.compile(r"^[ \t]*[A-Z][A-Z0-9 .'\-]{1,30}(\([A-Z. ]+\))?[ \t]*$")


def _count_character_cues(text: str) -> int:
    count = 0
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if _SCENE_RE.match(line):
            continue
        if _TRANSITION_RE.search(stripped):
            continue
        if not _CHAR_CUE_RE.match(line):
            continue
        words = stripped.split()
        if 1 <= len(words) <= 4 and any(c.isalpha() for c in stripped):
            count += 1
    return count


def score(text: str) -> tuple[float, list[str]]:
    if not text or not text.strip():
        return 0.0, []

    scene = len(_SCENE_RE.findall(text))
    trans = len(_TRANSITION_RE.findall(text))
    title = len(_TITLE_RE.findall(text))
    cues_n = _count_character_cues(text)

    raw = (
        min(scene, 5) * 3
        + min(trans, 3) * 2
        + min(cues_n, 6) * 0.5
        + min(title, 2) * 2
    )
    confidence = min(raw / 10.0, 1.0)

    matched: list[str] = []
    if scene:
        matched.append(f"{scene} scene heading(s) (INT./EXT.)")
    if trans:
        matched.append(f"{trans} transition(s) (e.g. FADE IN / CUT TO)")
    if cues_n:
        matched.append(f"{cues_n} character cue(s)")
    if title:
        matched.append("title-page phrase (written by / screenplay by)")

    return round(confidence, 3), matched
