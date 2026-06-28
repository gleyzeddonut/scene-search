from datetime import datetime

from scenesearch.model import ScriptEntry


def test_from_path_fills_metadata(tmp_path):
    f = tmp_path / "Chinatown.pdf"
    f.write_text("dummy")

    entry = ScriptEntry.from_path(f, confidence=0.9, matched_cues=["3 scene heading(s)"])

    assert entry.path == f
    assert entry.name == "Chinatown.pdf"
    assert entry.folder == tmp_path
    assert entry.file_type == "pdf"
    assert entry.size_bytes == len("dummy")
    assert isinstance(entry.modified, datetime)
    assert entry.confidence == 0.9
    assert entry.matched_cues == ["3 scene heading(s)"]
