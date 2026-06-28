from scenesearch.settings import Settings


def test_unset_roots_is_none(tmp_path):
    s = Settings(tmp_path / "settings.json")
    assert s.get_roots() is None


def test_set_and_reload_roots(tmp_path):
    p = tmp_path / "settings.json"
    Settings(p).set_roots(["/a/b", "/c/d"])

    assert Settings(p).get_roots() == ["/a/b", "/c/d"]


def test_empty_roots_is_respected_not_none(tmp_path):
    p = tmp_path / "settings.json"
    Settings(p).set_roots([])

    # An explicitly-cleared list persists as [] — distinct from "never set".
    assert Settings(p).get_roots() == []


def test_corrupt_settings_file_is_ignored(tmp_path):
    p = tmp_path / "settings.json"
    p.write_text("{ not valid json")
    s = Settings(p)  # must not raise
    assert s.get_roots() is None
