import pytest

from scenesearch import fileops


def test_copy_to(tmp_path):
    src = tmp_path / "a.txt"
    src.write_text("hello")
    dest_dir = tmp_path / "out"
    dest_dir.mkdir()

    result = fileops.copy_to(src, dest_dir)

    assert result == dest_dir / "a.txt"
    assert result.read_text() == "hello"
    assert src.exists()  # copy leaves original


def test_copy_to_collision_autosuffixes(tmp_path):
    src = tmp_path / "a.txt"
    src.write_text("hello")
    dest_dir = tmp_path / "out"
    dest_dir.mkdir()
    (dest_dir / "a.txt").write_text("existing")

    result = fileops.copy_to(src, dest_dir)

    assert result == dest_dir / "a (1).txt"
    assert result.read_text() == "hello"


def test_move_to(tmp_path):
    src = tmp_path / "a.txt"
    src.write_text("hello")
    dest_dir = tmp_path / "out"
    dest_dir.mkdir()

    result = fileops.move_to(src, dest_dir)

    assert result == dest_dir / "a.txt"
    assert not src.exists()


def test_rename(tmp_path):
    src = tmp_path / "old.txt"
    src.write_text("x")
    result = fileops.rename(src, "new.txt")
    assert result == tmp_path / "new.txt"
    assert result.exists()
    assert not src.exists()


def test_rename_collision_raises(tmp_path):
    src = tmp_path / "old.txt"
    src.write_text("x")
    (tmp_path / "taken.txt").write_text("y")
    with pytest.raises(FileExistsError):
        fileops.rename(src, "taken.txt")


def test_delete_to_trash_uses_send2trash(tmp_path, monkeypatch):
    called = {}
    monkeypatch.setattr(fileops, "send2trash", lambda p: called.setdefault("p", p))
    f = tmp_path / "a.txt"
    f.write_text("x")

    fileops.delete_to_trash(f)

    assert called["p"] == str(f)
