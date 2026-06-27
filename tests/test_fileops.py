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


def test_move_many_into_new_folder(tmp_path):
    src1 = tmp_path / "a.txt"
    src1.write_text("1")
    src2 = tmp_path / "b.txt"
    src2.write_text("2")
    dest_dir = tmp_path / "new folder"
    dest_dir.mkdir()

    results = fileops.move_many([src1, src2], dest_dir)

    assert {p.name for p in results} == {"a.txt", "b.txt"}
    assert not src1.exists() and not src2.exists()
    assert (dest_dir / "a.txt").read_text() == "1"
    assert (dest_dir / "b.txt").read_text() == "2"


def test_move_many_same_name_autosuffixes(tmp_path):
    src1 = tmp_path / "x" / "a.txt"
    src1.parent.mkdir()
    src1.write_text("1")
    src2 = tmp_path / "y" / "a.txt"
    src2.parent.mkdir()
    src2.write_text("2")
    dest_dir = tmp_path / "dest"
    dest_dir.mkdir()

    results = fileops.move_many([src1, src2], dest_dir)

    assert sorted(p.name for p in results) == ["a (1).txt", "a.txt"]


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
