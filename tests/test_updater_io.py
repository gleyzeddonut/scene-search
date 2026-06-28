import io
import os

from scenesearch.updater import download, write_swap_script


class _Resp:
    def __init__(self, data: bytes):
        self._b = io.BytesIO(data)
        self.headers = {"Content-Length": str(len(data))}

    def read(self, n=-1):
        return self._b.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_download_writes_bytes_and_reports_progress(tmp_path):
    data = b"abcdefgh" * 10000
    seen = []
    download(
        "http://x",
        tmp_path / "out.bin",
        opener=lambda url: _Resp(data),
        progress=seen.append,
    )
    assert (tmp_path / "out.bin").read_bytes() == data
    assert seen and seen[-1] == 100


def test_write_swap_script(tmp_path):
    old = tmp_path / "Scene Search.app"
    new = tmp_path / "staged" / "Scene Search.app"
    script = write_swap_script(old, new, 4242)
    assert script.exists()
    assert os.access(script, os.X_OK)
    text = script.read_text()
    assert text.startswith("#!/bin/bash")
    assert str(old) in text
    assert str(new) in text
    assert "4242" in text
    assert "open " in text
