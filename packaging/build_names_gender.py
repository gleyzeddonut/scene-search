"""Build scenesearch/screenplay/names_gender.json from public-domain US Social
Security baby-name data (mirrored as a single CSV by hadley/data-baby-names).
The underlying data is a US-government work and is public domain.

Run once:
    .venv/bin/python packaging/build_names_gender.py
"""
import collections
import csv
import io
import urllib.request
import json
from pathlib import Path

URL = "https://raw.githubusercontent.com/hadley/data-baby-names/master/baby-names.csv"
OUT = Path(__file__).resolve().parents[1] / "scenesearch" / "screenplay" / "names_gender.json"

_SEX = {"boy": "M", "girl": "F"}


def main() -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=120).read().decode()
    counts: dict[str, dict[str, float]] = collections.defaultdict(lambda: {"M": 0.0, "F": 0.0})
    for row in csv.DictReader(io.StringIO(raw)):
        sex = _SEX.get(row["sex"])
        if not sex:
            continue
        counts[row["name"].lower()][sex] += float(row["percent"])
    table: dict[str, str] = {}
    for name, c in counts.items():
        total = c["M"] + c["F"]
        if total <= 0:
            continue
        if c["M"] >= 0.95 * total:
            table[name] = "male"
        elif c["F"] >= 0.95 * total:
            table[name] = "female"
        # otherwise ambiguous -> omit so it resolves to "unknown"
    OUT.write_text(json.dumps(table, separators=(",", ":"), sort_keys=True))
    print(f"wrote {len(table)} names to {OUT}")


if __name__ == "__main__":
    main()
