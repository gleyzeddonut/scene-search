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


def test_ignored_round_trip(tmp_path):
    p = tmp_path / "settings.json"
    Settings(p).set_ignored(["/x/archive"])
    assert Settings(p).get_ignored() == ["/x/archive"]


def test_unset_ignored_is_none(tmp_path):
    assert Settings(tmp_path / "settings.json").get_ignored() is None


def test_roots_and_ignored_coexist(tmp_path):
    p = tmp_path / "settings.json"
    s = Settings(p)
    s.set_roots(["/a"])
    s.set_ignored(["/b"])
    reloaded = Settings(p)
    assert reloaded.get_roots() == ["/a"]
    assert reloaded.get_ignored() == ["/b"]


def test_unset_library_is_none(tmp_path):
    assert Settings(tmp_path / "s.json").get_library() is None


def test_library_round_trip(tmp_path):
    p = tmp_path / "s.json"
    Settings(p).set_library("/Users/x/Scripts")
    assert Settings(p).get_library() == "/Users/x/Scripts"


def test_check_updates_defaults_true(tmp_path):
    assert Settings(tmp_path / "s.json").get_check_updates() is True


def test_check_updates_round_trip(tmp_path):
    p = tmp_path / "s.json"
    Settings(p).set_check_updates(False)
    assert Settings(p).get_check_updates() is False
    Settings(p).set_check_updates(True)
    assert Settings(p).get_check_updates() is True


def test_theme_defaults_light(tmp_path):
    assert Settings(tmp_path / "s.json").get_theme() == "light"


def test_theme_round_trip(tmp_path):
    p = tmp_path / "s.json"
    Settings(p).set_theme("dark")
    assert Settings(p).get_theme() == "dark"


def test_theme_invalid_falls_back_to_light(tmp_path):
    p = tmp_path / "s.json"
    Settings(p).set_theme("rainbow")
    assert Settings(p).get_theme() == "light"


def test_corrupt_settings_file_is_ignored(tmp_path):
    p = tmp_path / "settings.json"
    p.write_text("{ not valid json")
    s = Settings(p)  # must not raise
    assert s.get_roots() is None
