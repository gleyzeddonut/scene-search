from scenesearch.scanner import iter_candidates, SCRIPT_EXTENSIONS, default_roots


def test_finds_script_extensions_and_skips_others(tmp_path):
    (tmp_path / "a.pdf").write_text("x")
    (tmp_path / "b.fountain").write_text("x")
    (tmp_path / "c.jpg").write_text("x")
    (tmp_path / "d.txt").write_text("x")

    names = {p.name for p in iter_candidates([tmp_path])}
    assert names == {"a.pdf", "b.fountain", "d.txt"}


def test_skips_noise_directories(tmp_path):
    good = tmp_path / "Scripts"
    good.mkdir()
    (good / "real.pdf").write_text("x")

    junk = tmp_path / "node_modules"
    junk.mkdir()
    (junk / "ignored.pdf").write_text("x")

    hidden = tmp_path / ".hidden"
    hidden.mkdir()
    (hidden / "secret.pdf").write_text("x")

    names = {p.name for p in iter_candidates([tmp_path])}
    assert names == {"real.pdf"}


def test_deduplicates_overlapping_roots(tmp_path):
    (tmp_path / "x.txt").write_text("x")
    results = list(iter_candidates([tmp_path, tmp_path]))
    assert len(results) == 1


def test_default_roots_returns_only_existing_dirs():
    for root in default_roots():
        assert root.is_dir()


def test_script_extensions_exact():
    assert SCRIPT_EXTENSIONS == {".pdf", ".fountain", ".fdx", ".txt", ".docx"}
