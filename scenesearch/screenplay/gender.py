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


_ROLE_GENDER = {
    "man": "male", "woman": "female", "boy": "male", "girl": "female",
    "guy": "male", "gal": "female", "gentleman": "male", "lady": "female",
    "mother": "female", "father": "male", "mom": "female", "mum": "female",
    "dad": "male", "husband": "male", "wife": "female", "son": "male",
    "daughter": "female", "brother": "male", "sister": "female",
    "grandmother": "female", "grandfather": "male", "grandma": "female",
    "grandpa": "male", "grandson": "male", "granddaughter": "female",
    "aunt": "female", "uncle": "male", "niece": "female", "nephew": "male",
    "king": "male", "queen": "female", "prince": "male", "princess": "female",
    "waiter": "male", "waitress": "female", "actor": "male", "actress": "female",
    "businessman": "male", "businesswoman": "female", "policeman": "male",
    "policewoman": "female", "widow": "female", "widower": "male",
    "bride": "female", "groom": "male", "girlfriend": "female",
    "boyfriend": "male", "stepmother": "female", "stepfather": "male",
    "mr": "male", "mrs": "female", "ms": "female", "sir": "male",
    "madam": "female", "maam": "female",
}


def gender_from_table(name: str, table: dict[str, str]) -> str:
    if not name:
        return "unknown"
    first = name.split()[0].lower().strip(".,'\"")
    return table.get(first, "unknown")


def role_gender(name: str) -> str:
    """Infer gender from gendered role words (MAN, WOMAN, WAITRESS, ...)."""
    found = set()
    for token in name.split():
        key = token.lower().strip(".,'\"")
        if key in _ROLE_GENDER:
            found.add(_ROLE_GENDER[key])
    return found.pop() if len(found) == 1 else "unknown"


def guess_gender(name: str) -> str:
    g = gender_from_table(name, _load_table())
    if g != "unknown":
        return g
    return role_gender(name)


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
