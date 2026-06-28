from scenesearch.library import Library
from scenesearch.finder import (
    FilterSpec,
    ScriptMatch,
    canonical_key,
    group_duplicates,
    scene_rows,
    script_rows,
)

SCRIPT = """\
INT. DINER - DAY

NEIL
Coffee.

EADY
Sure.

EXT. STREET - NIGHT

VINCENT
Anybody there?
"""


def _lib(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    return lib


def test_scene_rows_all(tmp_path):
    rows = scene_rows(_lib(tmp_path), FilterSpec(min_chars=1))
    assert [r.heading for r in rows] == ["INT. DINER - DAY", "EXT. STREET - NIGHT"]


def test_scene_rows_two_handers(tmp_path):
    rows = scene_rows(_lib(tmp_path), FilterSpec(min_chars=2, max_chars=2))
    assert [r.heading for r in rows] == ["INT. DINER - DAY"]


def test_script_rows_grouping(tmp_path):
    rows = script_rows(_lib(tmp_path), FilterSpec(min_chars=1))
    assert len(rows) == 1
    assert rows[0].script_name == "a.fountain"
    assert rows[0].match_count == 2


def test_canonical_key_strips_copy_suffixes():
    assert canonical_key("Heat.pdf") == "heat.pdf"
    assert canonical_key("Heat (1).pdf") == "heat.pdf"
    assert canonical_key("Heat (12).pdf") == "heat.pdf"
    assert canonical_key("Heat copy.pdf") == "heat.pdf"
    assert canonical_key("Heat copy 2.pdf") == "heat.pdf"
    assert canonical_key("Heat (1) copy.pdf") == "heat.pdf"
    assert canonical_key("Die Hard.pdf") != canonical_key("Heat.pdf")


def test_group_duplicates_folds_copies():
    rows = [
        ScriptMatch("/d/Heat.pdf", "Heat.pdf", 3),
        ScriptMatch("/d/Heat (1).pdf", "Heat (1).pdf", 3),
        ScriptMatch("/d/Heat (2).pdf", "Heat (2).pdf", 2),
        ScriptMatch("/d/Chinatown.pdf", "Chinatown.pdf", 5),
    ]
    groups = group_duplicates(rows)
    assert len(groups) == 2
    heat = groups[0]
    assert heat.canonical_name == "Heat.pdf"  # shortest name in the stack
    assert len(heat.members) == 3
    assert heat.total_match_count == 8
    assert groups[1].canonical_name == "Chinatown.pdf"
    assert len(groups[1].members) == 1
