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


def test_reindex_scans_all_folders(tmp_path):
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    (a / "one.fountain").write_text(SCRIPT)
    (b / "two.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex([a, b])
    assert lib.script_count() == 2


def test_reindex_respects_ignored_dirs(tmp_path):
    sub = tmp_path / "skipme"
    sub.mkdir()
    (tmp_path / "keep.fountain").write_text(SCRIPT)
    (sub / "drop.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex([tmp_path], ignore_dirs=[sub])
    assert lib.script_count() == 1


def test_reindex_full_reparse_after_version_bump(tmp_path):
    (tmp_path / "s.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    # simulate an index written by an older app version with no dialogue
    lib._conn.execute("UPDATE scenes SET dialogue_json='[]'")
    lib._conn.execute("PRAGMA user_version = 0")
    lib._conn.commit()
    lib2 = Library(tmp_path / "index.db")
    lib2.reindex(tmp_path)  # mtime unchanged, but version is stale -> full re-parse
    m = lib2.query(min_chars=1)[0]
    scene = lib2.get_scene(m.script_path, m.scene_index)
    assert len(scene["lines"]) > 0


def test_reindex_can_be_cancelled(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    (tmp_path / "b.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path, should_cancel=lambda: True)
    assert lib.script_count() == 0  # stopped before indexing anything


def test_cancelled_reindex_keeps_existing_entries(tmp_path):
    (tmp_path / "a.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.reindex(tmp_path)
    assert lib.script_count() == 1
    # a cancelled re-scan must not prune what was already indexed
    lib.reindex(tmp_path, should_cancel=lambda: True)
    assert lib.script_count() == 1


def test_add_file_adds_and_detects_duplicate(tmp_path):
    f = tmp_path / "a.fountain"
    f.write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    assert lib.add_file(f) == "added"
    assert lib.script_count() == 1
    assert lib.add_file(f) == "exists"


def test_add_file_rejects_non_script(tmp_path):
    f = tmp_path / "note.md"
    f.write_text("just a note")
    lib = Library(tmp_path / "index.db")
    assert lib.add_file(f) == "not_script"
    assert lib.script_count() == 0


def test_dropped_file_survives_reindex_of_other_folder(tmp_path):
    a = tmp_path / "a"
    a.mkdir()
    fa = a / "drop.fountain"
    fa.write_text(SCRIPT)
    b = tmp_path / "b"
    b.mkdir()
    (b / "x.fountain").write_text(SCRIPT)
    lib = Library(tmp_path / "index.db")
    lib.add_file(fa)  # dropped file in folder A
    lib.reindex([b])  # later re-index of a DIFFERENT folder
    assert lib.script_count() == 2  # the pinned drop is not pruned


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
