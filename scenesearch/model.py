from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class ScriptEntry:
    path: Path
    name: str
    folder: Path
    file_type: str
    size_bytes: int
    modified: datetime
    confidence: float
    matched_cues: list[str] = field(default_factory=list)

    @classmethod
    def from_path(cls, path, confidence: float, matched_cues: list[str]) -> "ScriptEntry":
        p = Path(path)
        st = p.stat()
        return cls(
            path=p,
            name=p.name,
            folder=p.parent,
            file_type=p.suffix.lower().lstrip("."),
            size_bytes=st.st_size,
            modified=datetime.fromtimestamp(st.st_mtime),
            confidence=confidence,
            matched_cues=list(matched_cues),
        )
