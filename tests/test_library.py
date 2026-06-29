from scenesearch.library import Library
from scenesearch.extractors import extract_paginated

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


def test_extract_paginated_plaintext(tmp_path):
    f = tmp_path / "a.fountain"
    f.write_text(SCRIPT)
    assert "INT. DINER" in extract_paginated(f)


def test_reindex_counts_scripts_and_scenes(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    assert lib.script_count() == 1
    assert lib.scene_count() == 2
    assert lib.is_indexed() is True


def test_query_by_char_count(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    two = lib.query(min_chars=2, max_chars=2)
    assert [m.heading for m in two] == ["INT. DINER - DAY"]
    assert two[0].characters == ["NEIL", "EADY"]
    assert two[0].script_name == "a.fountain"


def test_get_scene_returns_lines(tmp_path):
    (tmp_path / "a.fountain").write_text(
        "INT. OFFICE - DAY\n\nMICHAEL\nSit.\n\nJENNIFER\nNo.\n")
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    m = lib.query(min_chars=2)[0]
    scene = lib.get_scene(m.script_path, m.scene_index)
    assert scene["heading"] == "INT. OFFICE - DAY"
    assert scene["lines"] == [{"who": "MICHAEL", "text": "Sit."},
                              {"who": "JENNIFER", "text": "No."}]
    assert scene["est_seconds"] >= 0


def test_non_script_files_are_not_counted(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    (tmp_path / "notes.txt").write_text("grocery list: milk, eggs, bread")
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    assert lib.script_count() == 1  # notes.txt has 0 scenes


def test_reindex_is_incremental(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    lib.reindex(tmp_path)
    assert lib.scene_count() == 2


def test_remove_script(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    path = lib.query(min_chars=1)[0].script_path
    lib.remove_script(path)
    assert lib.script_count() == 0
    assert lib.scene_count() == 0


def test_reindex_drops_deleted_files(tmp_path):
    f = tmp_path / "a.fountain"
    f.write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    f.unlink()
    lib.reindex(tmp_path)
    assert lib.script_count() == 0
    assert lib.scene_count() == 0
