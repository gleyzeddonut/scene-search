from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .cache import ScoreCache
from .classifier import DEFAULT_THRESHOLD, score
from .extractors import ExtractionError, extract_text
from .model import ScriptEntry
from .scanner import iter_candidates


@dataclass
class FoundEvent:
    entry: ScriptEntry


@dataclass
class UnreadableEvent:
    path: Path
    reason: str


@dataclass
class ProgressEvent:
    scanned: int
    current: Path


def scan_for_scripts(
    roots,
    threshold: float = DEFAULT_THRESHOLD,
    cache: ScoreCache | None = None,
) -> Iterator[object]:
    scanned = 0
    for path in iter_candidates(roots):
        scanned += 1
        yield ProgressEvent(scanned, path)

        try:
            st = path.stat()
        except OSError as exc:
            yield UnreadableEvent(path, str(exc))
            continue

        cached = cache.get(path, st.st_mtime, st.st_size) if cache else None
        if cached is not None:
            confidence = cached["confidence"]
            cues = cached["cues"]
        else:
            try:
                text = extract_text(path)
            except ExtractionError as exc:
                yield UnreadableEvent(path, exc.reason)
                continue
            if not text.strip():
                yield UnreadableEvent(
                    path, "no extractable text (maybe a scanned image)"
                )
                continue
            confidence, cues = score(text)
            if cache is not None:
                cache.put(path, st.st_mtime, st.st_size, confidence, cues)

        if confidence >= threshold:
            yield FoundEvent(ScriptEntry.from_path(path, confidence, cues))
