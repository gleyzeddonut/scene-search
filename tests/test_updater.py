import io
import json

from scenesearch.updater import (
    UpdateInfo,
    is_newer,
    parse_release,
    current_arch,
    is_translocated,
    check_for_update,
)


def test_is_newer():
    assert is_newer("1.5.0", "1.4.0") is True
    assert is_newer("1.4.1", "1.4.0") is True
    assert is_newer("1.4.0", "1.4.0") is False
    assert is_newer("1.4.0", "1.5.0") is False
    assert is_newer("1.4", "1.3.9") is True
    assert is_newer("v1.5.0", "1.4.0") is True
    assert is_newer("garbage", "1.4.0") is False


def _release_json():
    return {
        "tag_name": "v1.5.0",
        "body": "Notes here",
        "assets": [
            {"name": "Scene-Search-macOS-arm64.zip",
             "browser_download_url": "https://example/arm64.zip"},
            {"name": "Scene-Search-macOS-x86_64.zip",
             "browser_download_url": "https://example/x86_64.zip"},
        ],
    }


def test_parse_release():
    tag, assets = parse_release(_release_json())
    assert tag == "1.5.0"
    assert assets == {
        "arm64": "https://example/arm64.zip",
        "x86_64": "https://example/x86_64.zip",
    }


def test_current_arch_is_known():
    assert current_arch() in ("arm64", "x86_64")


def test_is_translocated():
    assert is_translocated("/private/var/folders/x/AppTranslocation/ABC/d/Scene Search.app")
    assert not is_translocated("/Users/x/Applications/Scene Search.app")


class _Resp:
    def __init__(self, data: bytes):
        self._b = io.BytesIO(data)

    def read(self, n=-1):
        return self._b.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_check_for_update_returns_info_when_newer():
    opener = lambda req, timeout=None: _Resp(json.dumps(_release_json()).encode())
    info = check_for_update(opener=opener, arch="arm64", current="1.4.0")
    assert isinstance(info, UpdateInfo)
    assert info.version == "1.5.0"
    assert info.url == "https://example/arm64.zip"


def test_check_for_update_none_when_same_or_older():
    opener = lambda req, timeout=None: _Resp(json.dumps(_release_json()).encode())
    assert check_for_update(opener=opener, arch="arm64", current="1.5.0") is None
    assert check_for_update(opener=opener, arch="arm64", current="2.0.0") is None


def test_check_for_update_none_on_network_error():
    def opener(req, timeout=None):
        raise OSError("offline")

    assert check_for_update(opener=opener, arch="arm64", current="1.0.0") is None


def test_check_for_update_none_when_arch_missing():
    data = _release_json()
    data["assets"] = [data["assets"][0]]  # arm64 only
    opener = lambda req, timeout=None: _Resp(json.dumps(data).encode())
    assert check_for_update(opener=opener, arch="x86_64", current="1.4.0") is None


def test_parse_release_ignores_non_zip_sidecars():
    data = {
        "tag_name": "v1.5.0",
        "assets": [
            {"name": "Scene-Search-macOS-arm64.zip",
             "browser_download_url": "GOOD-arm"},
            {"name": "Scene-Search-macOS-arm64.zip.sha256",
             "browser_download_url": "BAD-checksum"},
            {"name": "Scene-Search-macOS-x86_64.zip",
             "browser_download_url": "GOOD-intel"},
        ],
    }
    _tag, assets = parse_release(data)
    assert assets["arm64"] == "GOOD-arm"
    assert assets["x86_64"] == "GOOD-intel"
