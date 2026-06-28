from scenesearch.library import Library
from scenesearch.finder import FilterSpec, scene_rows, script_rows

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
