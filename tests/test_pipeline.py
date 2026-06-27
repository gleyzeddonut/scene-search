from scenesearch.pipeline import (
    scan_for_scripts,
    FoundEvent,
    UnreadableEvent,
    ProgressEvent,
)

SCRIPT = """\
INT. COFFEE SHOP - DAY

JOHN
I can't believe it.

EXT. STREET - NIGHT

FADE OUT.
"""


def test_finds_real_script_and_skips_junk(tmp_path):
    (tmp_path / "real.fountain").write_text(SCRIPT)
    (tmp_path / "notes.txt").write_text("just a shopping list of groceries")

    events = list(scan_for_scripts([tmp_path]))

    found = [e for e in events if isinstance(e, FoundEvent)]
    assert len(found) == 1
    assert found[0].entry.name == "real.fountain"
    assert found[0].entry.confidence >= 0.35


def test_emits_progress_events(tmp_path):
    (tmp_path / "a.txt").write_text("x")
    events = list(scan_for_scripts([tmp_path]))
    assert any(isinstance(e, ProgressEvent) for e in events)


def test_empty_text_file_is_unreadable(tmp_path):
    (tmp_path / "blank.txt").write_text("")
    events = list(scan_for_scripts([tmp_path]))
    assert any(isinstance(e, UnreadableEvent) for e in events)


def test_cache_avoids_recompute(tmp_path):
    from scenesearch.cache import ScoreCache

    f = tmp_path / "real.fountain"
    f.write_text(SCRIPT)
    cache = ScoreCache(tmp_path / "cache.json")

    list(scan_for_scripts([tmp_path], cache=cache))
    st = f.stat()
    assert cache.get(f, st.st_mtime, st.st_size) is not None
