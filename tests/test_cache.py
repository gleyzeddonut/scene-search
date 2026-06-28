from scenesearch.cache import ScoreCache


def test_put_then_get_hit(tmp_path):
    f = tmp_path / "s.pdf"
    f.write_text("x")
    cache = ScoreCache(tmp_path / "cache.json")
    st = f.stat()

    cache.put(f, st.st_mtime, st.st_size, 0.8, ["3 scene heading(s)"])
    hit = cache.get(f, st.st_mtime, st.st_size)

    assert hit == {"confidence": 0.8, "cues": ["3 scene heading(s)"]}


def test_changed_mtime_misses(tmp_path):
    f = tmp_path / "s.pdf"
    f.write_text("x")
    cache = ScoreCache(tmp_path / "cache.json")
    st = f.stat()
    cache.put(f, st.st_mtime, st.st_size, 0.8, [])

    assert cache.get(f, st.st_mtime + 10, st.st_size) is None


def test_persists_across_load(tmp_path):
    f = tmp_path / "s.pdf"
    f.write_text("x")
    st = f.stat()
    cache_path = tmp_path / "cache.json"

    c1 = ScoreCache(cache_path)
    c1.put(f, st.st_mtime, st.st_size, 0.5, ["x"])
    c1.save()

    c2 = ScoreCache(cache_path)
    assert c2.get(f, st.st_mtime, st.st_size) == {"confidence": 0.5, "cues": ["x"]}


def test_corrupt_cache_file_is_ignored(tmp_path):
    cache_path = tmp_path / "cache.json"
    cache_path.write_text("{ not valid json")
    cache = ScoreCache(cache_path)  # must not raise
    assert cache.get(tmp_path / "x.pdf", 1.0, 1) is None
