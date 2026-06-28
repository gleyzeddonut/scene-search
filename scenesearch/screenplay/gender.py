from __future__ import annotations

import json
from pathlib import Path

_TABLE: dict[str, str] | None = None


def _load_table() -> dict[str, str]:
    global _TABLE
    if _TABLE is None:
        path = Path(__file__).with_name("names_gender.json")
        try:
            _TABLE = json.loads(path.read_text())
        except Exception:
            _TABLE = {}
    return _TABLE


def gender_from_table(name: str, table: dict[str, str]) -> str:
    if not name:
        return "unknown"
    first = name.split()[0].lower().strip(".,'\"")
    return table.get(first, "unknown")


def guess_gender(name: str) -> str:
    return gender_from_table(name, _load_table())


def pairing_from_genders(genders: list[str]) -> str | None:
    if len(genders) != 2:
        return None
    if "unknown" in genders:
        return "has_unknown"
    if genders == ["male", "male"]:
        return "MM"
    if genders == ["female", "female"]:
        return "WW"
    return "MW"


def scene_pairing(characters: list[str]) -> str | None:
    return pairing_from_genders([guess_gender(c) for c in characters])
