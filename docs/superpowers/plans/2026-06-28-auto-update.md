# In-App Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the packaged macOS app detect newer GitHub releases, download the matching notarized build, and swap itself in and relaunch.

**Architecture:** A GUI-free `updater.py` (version compare, GitHub API parse, arch/asset pick, app-bundle location, download, signature verify, swap-script writer) plus thin Qt workers and a banner wired into `MainWindow`. Releases live on a public GitHub repo; the app reads the unauthenticated latest-release API.

**Tech Stack:** Python 3 (`urllib`, `subprocess`, `sqlite3` already), PySide6, `gh` CLI + `ditto`/`codesign` for packaging.

## Global Constraints

- macOS only. Updater is **active only in the frozen `.app`** (`getattr(sys, "frozen", False)`).
- Public repo: **`gleyzeddonut/scene-search`**. Latest-release API: `https://api.github.com/repos/gleyzeddonut/scene-search/releases/latest`.
- Release tags are `vX.Y.Z`; assets named `Scene-Search-macOS-arm64.zip` and `Scene-Search-macOS-x86_64.zip`.
- Developer ID Team for verification: **`K7VM2MP885`**.
- Single version source: `scenesearch/version.py` `__version__`; the PyInstaller spec reads it.
- Core modules under `scenesearch/` must not import PySide6 (only `scenesearch/ui/` and `app.py`).
- All update-check network failures are silent (no banner, no dialog). Updates are always user-initiated.
- Unzip downloaded apps with `ditto` (preserves the code signature); never Python `zipfile`.

---

### Task 1: Single-source version + wire into the build

**Files:**
- Create: `scenesearch/version.py`
- Modify: `packaging/Scene Search.spec`
- Test: `tests/test_version.py`

**Interfaces:**
- Produces: `scenesearch.version.__version__: str`.

- [ ] **Step 1: Write the failing test**

`tests/test_version.py`:
```python
import re

from scenesearch.version import __version__


def test_version_is_semver():
    assert re.fullmatch(r"\d+\.\d+\.\d+", __version__)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_version.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.version'`.

- [ ] **Step 3: Create the version module**

`scenesearch/version.py`:
```python
__version__ = "1.4.0"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_version.py -v`
Expected: PASS.

- [ ] **Step 5: Make the PyInstaller spec read it**

In `packaging/Scene Search.spec`, just after `PROJECT_ROOT = os.path.abspath(...)`, add:
```python
import sys as _sys
if PROJECT_ROOT not in _sys.path:
    _sys.path.insert(0, PROJECT_ROOT)
from scenesearch.version import __version__ as APP_VERSION
```
Then replace the two hardcoded version lines:
```python
        "CFBundleShortVersionString": "1.3.0",
        "CFBundleVersion": "1.3.0",
```
with:
```python
        "CFBundleShortVersionString": APP_VERSION,
        "CFBundleVersion": APP_VERSION,
```

- [ ] **Step 6: Commit**

```bash
git add scenesearch/version.py "packaging/Scene Search.spec" tests/test_version.py
git commit -m "feat: single-source app version in scenesearch/version.py"
```

---

### Task 2: Updater core (pure logic + check)

**Files:**
- Create: `scenesearch/updater.py`
- Test: `tests/test_updater.py`

**Interfaces:**
- Consumes: `scenesearch.version.__version__`.
- Produces:
  - `API_URL: str`, `TEAM_ID = "K7VM2MP885"`.
  - `UpdateInfo` dataclass: `version: str`, `url: str`, `notes: str`.
  - `is_newer(latest: str, current: str) -> bool` (semver; malformed → False).
  - `parse_release(data: dict) -> tuple[str, dict[str, str]]` → (tag without `v`, `{"arm64": url, "x86_64": url}`).
  - `current_arch() -> str` (`"arm64"`/`"x86_64"`).
  - `running_app_bundle() -> Path | None` (frozen `.app` root, else None).
  - `is_translocated(path) -> bool`.
  - `check_for_update(opener=urllib.request.urlopen, arch=None, current=None) -> UpdateInfo | None`.

- [ ] **Step 1: Write the failing tests**

`tests/test_updater.py`:
```python
import io
import json

from scenesearch import updater
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
    opener = lambda req: _Resp(json.dumps(_release_json()).encode())
    info = check_for_update(opener=opener, arch="arm64", current="1.4.0")
    assert isinstance(info, UpdateInfo)
    assert info.version == "1.5.0"
    assert info.url == "https://example/arm64.zip"


def test_check_for_update_none_when_same_or_older():
    opener = lambda req: _Resp(json.dumps(_release_json()).encode())
    assert check_for_update(opener=opener, arch="arm64", current="1.5.0") is None
    assert check_for_update(opener=opener, arch="arm64", current="2.0.0") is None


def test_check_for_update_none_on_network_error():
    def opener(req):
        raise OSError("offline")

    assert check_for_update(opener=opener, arch="arm64", current="1.0.0") is None


def test_check_for_update_none_when_arch_missing():
    data = _release_json()
    data["assets"] = [data["assets"][0]]  # arm64 only
    opener = lambda req: _Resp(json.dumps(data).encode())
    assert check_for_update(opener=opener, arch="x86_64", current="1.4.0") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_updater.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scenesearch.updater'`.

- [ ] **Step 3: Write minimal implementation**

`scenesearch/updater.py`:
```python
from __future__ import annotations

import json
import platform
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .version import __version__

API_URL = "https://api.github.com/repos/gleyzeddonut/scene-search/releases/latest"
TEAM_ID = "K7VM2MP885"


@dataclass
class UpdateInfo:
    version: str
    url: str
    notes: str = ""


def _parse_version(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in v.strip().lstrip("vV").split("."))


def is_newer(latest: str, current: str) -> bool:
    try:
        lt = _parse_version(latest)
        cur = _parse_version(current)
    except (ValueError, AttributeError):
        return False
    n = max(len(lt), len(cur))
    lt = lt + (0,) * (n - len(lt))
    cur = cur + (0,) * (n - len(cur))
    return lt > cur


def parse_release(data: dict) -> tuple[str, dict[str, str]]:
    tag = str(data.get("tag_name", "")).lstrip("vV")
    assets: dict[str, str] = {}
    for asset in data.get("assets", []):
        name = asset.get("name", "")
        url = asset.get("browser_download_url", "")
        if "arm64" in name:
            assets["arm64"] = url
        elif "x86_64" in name:
            assets["x86_64"] = url
    return tag, assets


def current_arch() -> str:
    machine = platform.machine()
    if machine == "arm64":
        return "arm64"
    if machine in ("x86_64", "amd64"):
        return "x86_64"
    return machine


def running_app_bundle() -> Path | None:
    if not getattr(sys, "frozen", False):
        return None
    exe = Path(sys.executable)
    if len(exe.parents) >= 3:
        bundle = exe.parents[2]  # .app/Contents/MacOS/<exe>
        if bundle.suffix == ".app":
            return bundle
    return None


def is_translocated(path) -> bool:
    return "/AppTranslocation/" in str(path)


def _request(url: str):
    return urllib.request.Request(
        url,
        headers={"User-Agent": "SceneSearch", "Accept": "application/vnd.github+json"},
    )


def check_for_update(opener=urllib.request.urlopen, arch=None, current=None):
    arch = arch or current_arch()
    current = current or __version__
    try:
        with opener(_request(API_URL)) as resp:
            data = json.loads(resp.read())
    except Exception:
        return None
    version, assets = parse_release(data)
    if not version or arch not in assets:
        return None
    if not is_newer(version, current):
        return None
    return UpdateInfo(version=version, url=assets[arch], notes=str(data.get("body") or ""))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_updater.py -v`
Expected: PASS (9 passed).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/updater.py tests/test_updater.py
git commit -m "feat: updater core (version compare, release parse, update check)"
```

---

### Task 3: Updater IO helpers (download, unzip, verify, swap script)

**Files:**
- Modify: `scenesearch/updater.py`
- Test: `tests/test_updater_io.py`

**Interfaces:**
- Consumes: Task 2 module.
- Produces:
  - `download(url, dest, opener=urllib.request.urlopen, progress=None, chunk=65536) -> None`.
  - `unzip_app(zip_path, dest_dir) -> Path | None` (uses `ditto`).
  - `verify_bundle(app_path, team_id=TEAM_ID) -> bool` (uses `codesign`).
  - `write_swap_script(old_app, new_app, pid) -> Path` (executable bash).

- [ ] **Step 1: Write the failing tests**

`tests/test_updater_io.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_updater_io.py -v`
Expected: FAIL with `ImportError: cannot import name 'download'`.

- [ ] **Step 3: Write minimal implementation**

Append to `scenesearch/updater.py`:
```python
import os
import shlex
import subprocess
import tempfile


def download(url, dest, opener=urllib.request.urlopen, progress=None, chunk=65536) -> None:
    with opener(url) as resp:
        total = int(getattr(resp, "headers", {}).get("Content-Length") or 0)
        got = 0
        with open(dest, "wb") as f:
            while True:
                buf = resp.read(chunk)
                if not buf:
                    break
                f.write(buf)
                got += len(buf)
                if progress and total:
                    progress(min(100, int(got * 100 / total)))
        if progress:
            progress(100)


def unzip_app(zip_path, dest_dir) -> Path | None:
    subprocess.run(
        ["ditto", "-x", "-k", str(zip_path), str(dest_dir)], check=True
    )
    apps = sorted(Path(dest_dir).glob("*.app"))
    return apps[0] if apps else None


def verify_bundle(app_path, team_id: str = TEAM_ID) -> bool:
    try:
        subprocess.run(
            ["codesign", "--verify", "--strict", str(app_path)],
            check=True, capture_output=True,
        )
        out = subprocess.run(
            ["codesign", "-dvv", str(app_path)], capture_output=True, text=True
        )
        return team_id in (out.stdout + out.stderr)
    except Exception:
        return False


def write_swap_script(old_app, new_app, pid) -> Path:
    old = str(old_app)
    new = str(new_app)
    script = f"""#!/bin/bash
OLD={shlex.quote(old)}
NEW={shlex.quote(new)}
PID={int(pid)}
for _ in $(seq 1 120); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.5
done
if ! ( rm -rf "$OLD" && mv "$NEW" "$OLD" ) 2>/dev/null; then
    /usr/bin/osascript -e "do shell script \\"rm -rf \\" & quoted form of \\"$OLD\\" & \\" && mv \\" & quoted form of \\"$NEW\\" & \\" \\" & quoted form of \\"$OLD\\" with administrator privileges"
fi
open "$OLD"
"""
    path = Path(tempfile.mkdtemp()) / "scene_search_swap.sh"
    path.write_text(script)
    os.chmod(path, 0o755)
    return path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_updater_io.py -v`
Expected: PASS (2 passed).

> `unzip_app` and `verify_bundle` shell out to `ditto`/`codesign` and are verified in the manual end-to-end (Task 6), not unit tests.

- [ ] **Step 5: Commit**

```bash
git add scenesearch/updater.py tests/test_updater_io.py
git commit -m "feat: updater IO (download, unzip, verify, swap script)"
```

---

### Task 4: Qt update workers

**Files:**
- Create: `scenesearch/ui/update_worker.py`

**Interfaces:**
- Consumes: `check_for_update`, `download`, `unzip_app`, `verify_bundle`, `UpdateInfo`, `TEAM_ID` (updater).
- Produces:
  - `CheckWorker(QObject)`: signals `update_available(object)` (UpdateInfo), `no_update()`; method `run()`.
  - `DownloadWorker(QObject)`: ctor `(url, staging_dir)`; signals `progress(int)`, `ready(str)` (staged `.app` path), `failed(str)`; method `run()`.

- [ ] **Step 1: Write the implementation**

`scenesearch/ui/update_worker.py`:
```python
from __future__ import annotations

import tempfile
from pathlib import Path

from PySide6.QtCore import QObject, Signal

from ..updater import (
    TEAM_ID,
    check_for_update,
    download,
    unzip_app,
    verify_bundle,
)


class CheckWorker(QObject):
    update_available = Signal(object)  # UpdateInfo
    no_update = Signal()

    def run(self) -> None:
        info = check_for_update()
        if info is not None:
            self.update_available.emit(info)
        else:
            self.no_update.emit()


class DownloadWorker(QObject):
    progress = Signal(int)
    ready = Signal(str)   # staged .app path
    failed = Signal(str)

    def __init__(self, url: str):
        super().__init__()
        self._url = url

    def run(self) -> None:
        try:
            staging = Path(tempfile.mkdtemp(prefix="scenesearch-update-"))
            zip_path = staging / "update.zip"
            download(self._url, zip_path, progress=self.progress.emit)
            app = unzip_app(zip_path, staging)
            if app is None:
                self.failed.emit("Downloaded file did not contain the app.")
                return
            if not verify_bundle(app, TEAM_ID):
                self.failed.emit("Downloaded app failed signature verification.")
                return
            self.ready.emit(str(app))
        except Exception as exc:
            self.failed.emit(str(exc))
```

- [ ] **Step 2: Smoke-test imports**

Run: `QT_QPA_PLATFORM=offscreen .venv/bin/python -c "from scenesearch.ui.update_worker import CheckWorker, DownloadWorker; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add scenesearch/ui/update_worker.py
git commit -m "feat: Qt update workers (check + download)"
```

---

### Task 5: Update banner + MainWindow integration

**Files:**
- Create: `scenesearch/ui/update_banner.py`
- Modify: `scenesearch/ui/main_window.py`

**Interfaces:**
- Consumes: `CheckWorker`, `DownloadWorker` (Task 4); `running_app_bundle`, `is_translocated`, `write_swap_script` (updater); `__version__`.
- Produces: `UpdateBanner(QWidget)` with `message_label`, `action_button`, and helper methods; `MainWindow` hosting the banner above the tabs, starting the check on launch and handling Update/Relaunch.

- [ ] **Step 1: Write the banner**

`scenesearch/ui/update_banner.py`:
```python
from __future__ import annotations

from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QWidget


class UpdateBanner(QWidget):
    """Thin banner shown only when an update is relevant."""

    def __init__(self):
        super().__init__()
        self.setStyleSheet("background:#2d4a7a; color:white;")
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 4, 10, 4)
        self.message_label = QLabel("")
        self.action_button = QPushButton("")
        layout.addWidget(self.message_label, 1)
        layout.addWidget(self.action_button)
        self.setVisible(False)

    def show_available(self, version: str) -> None:
        self.message_label.setText(f"Update available: v{version}")
        self.action_button.setText("Update")
        self.action_button.setVisible(True)
        self.setVisible(True)

    def show_downloading(self, percent: int) -> None:
        self.message_label.setText(f"Downloading update… {percent}%")
        self.action_button.setVisible(False)
        self.setVisible(True)

    def show_ready(self) -> None:
        self.message_label.setText("Update downloaded.")
        self.action_button.setText("Relaunch to finish")
        self.action_button.setVisible(True)
        self.setVisible(True)

    def show_message(self, text: str) -> None:
        self.message_label.setText(text)
        self.action_button.setVisible(False)
        self.setVisible(True)
```

- [ ] **Step 2: Integrate into MainWindow**

In `scenesearch/ui/main_window.py`, replace the imports block and class body as follows.

Change imports:
```python
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from PySide6.QtCore import QThread
from PySide6.QtWidgets import QMainWindow, QTabWidget, QVBoxLayout, QWidget

from ..cache import ScoreCache
from ..settings import Settings
from ..updater import is_translocated, running_app_bundle, write_swap_script
from ..version import __version__
from .finder_tab import FinderTab
from .search_tab import SearchTab
from .update_banner import UpdateBanner
from .update_worker import CheckWorker, DownloadWorker
```

Replace the `__init__` body's central-widget setup (the `self.tabs = QTabWidget(); self.setCentralWidget(self.tabs)` lines) with a banner + tabs container, and start the check. The full new `__init__` and the update methods:
```python
    def __init__(self, settings_path=None, cache_path=None, index_path=None):
        super().__init__()
        self.setWindowTitle("Scene Search")
        self.resize(1000, 700)

        self._settings = Settings(settings_path or Path.home() / ".scenesearch_settings.json")
        self._cache = ScoreCache(cache_path or Path.home() / ".scenesearch_cache.json")
        self._index_path = index_path or Path.home() / ".scenesearch_index.db"

        self._update_info = None
        self._staged_app = None
        self._update_thread: QThread | None = None
        self._update_worker = None

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.update_banner = UpdateBanner()
        self.update_banner.action_button.clicked.connect(self._on_banner_action)
        layout.addWidget(self.update_banner)

        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)
        self.setCentralWidget(container)

        self.search_tab = SearchTab(self._settings, self._cache)
        self.tabs.addTab(self.search_tab, "Search")
        self.finder_tab = FinderTab(self._settings, self._index_path)
        self.tabs.addTab(self.finder_tab, "Finder")

        self._start_update_check()

    # ---------- Update check ----------
    def _start_update_check(self) -> None:
        self._update_thread = QThread()
        self._update_worker = CheckWorker()
        self._update_worker.moveToThread(self._update_thread)
        self._update_thread.started.connect(self._update_worker.run)
        self._update_worker.update_available.connect(self._on_update_available)
        self._update_worker.update_available.connect(self._update_thread.quit)
        self._update_worker.no_update.connect(self._update_thread.quit)
        self._update_thread.finished.connect(self._update_worker.deleteLater)
        self._update_thread.finished.connect(self._update_thread.deleteLater)
        self._update_thread.finished.connect(self._clear_update_thread)
        self._update_thread.start()

    def _clear_update_thread(self) -> None:
        self._update_thread = None
        self._update_worker = None

    def _on_update_available(self, info) -> None:
        self._update_info = info
        bundle = running_app_bundle()
        if bundle is None:
            self.update_banner.show_message(
                f"Update available: v{info.version} (updates apply to the installed app)."
            )
        elif is_translocated(bundle):
            self.update_banner.show_message(
                "Update available — move Scene Search to your Applications folder to enable updates."
            )
        else:
            self.update_banner.show_available(info.version)

    # ---------- Banner action (Update / Relaunch) ----------
    def _on_banner_action(self) -> None:
        if self._staged_app is not None:
            self._relaunch_with_update()
        elif self._update_info is not None:
            self._start_download()

    def _start_download(self) -> None:
        self.update_banner.show_downloading(0)
        self._dl_thread = QThread()
        self._dl_worker = DownloadWorker(self._update_info.url)
        self._dl_worker.moveToThread(self._dl_thread)
        self._dl_thread.started.connect(self._dl_worker.run)
        self._dl_worker.progress.connect(self.update_banner.show_downloading)
        self._dl_worker.ready.connect(self._on_download_ready)
        self._dl_worker.failed.connect(self._on_download_failed)
        self._dl_worker.ready.connect(self._dl_thread.quit)
        self._dl_worker.failed.connect(self._dl_thread.quit)
        self._dl_thread.finished.connect(self._dl_worker.deleteLater)
        self._dl_thread.finished.connect(self._dl_thread.deleteLater)
        self._dl_thread.start()

    def _on_download_ready(self, app_path: str) -> None:
        self._staged_app = app_path
        self.update_banner.show_ready()

    def _on_download_failed(self, message: str) -> None:
        self._staged_app = None
        self.update_banner.show_message(f"Update failed: {message}")
        # let them try again
        if self._update_info is not None:
            self.update_banner.show_available(self._update_info.version)

    def _relaunch_with_update(self) -> None:
        bundle = running_app_bundle()
        if bundle is None or self._staged_app is None:
            return
        script = write_swap_script(bundle, self._staged_app, os.getpid())
        subprocess.Popen(["/bin/bash", str(script)], start_new_session=True)
        from PySide6.QtWidgets import QApplication

        QApplication.quit()
```

Keep the existing `closeEvent` method as-is.

- [ ] **Step 3: Verify offscreen (no real network)**

Run:
```bash
QT_QPA_PLATFORM=offscreen .venv/bin/python -c "
import sys, tempfile, pathlib
from PySide6.QtWidgets import QApplication
app = QApplication(sys.argv)
from scenesearch.ui.main_window import MainWindow
from scenesearch.updater import UpdateInfo
d = pathlib.Path(tempfile.mkdtemp())
mw = MainWindow(settings_path=d/'s.json', cache_path=d/'c.json', index_path=d/'i.db')
# simulate the check finding an update (dev build -> message, not button)
mw._on_update_available(UpdateInfo('9.9.9', 'http://x/arm64.zip', 'notes'))
print('banner visible:', mw.update_banner.isVisible())
print('banner text:', mw.update_banner.message_label.text())
print('ok')
" 2>/dev/null
```
Expected: prints `banner visible: True`, a message mentioning v9.9.9, and `ok`. (In a dev run `running_app_bundle()` is None, so it shows the message form — correct.)

- [ ] **Step 4: Run the full suite**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add scenesearch/ui/update_banner.py scenesearch/ui/main_window.py
git commit -m "feat: update banner + check/download/relaunch wiring in MainWindow"
```

---

### Task 6: Publish flow + GitHub repo + end-to-end verification

**Files:**
- Create: `packaging/publish_release.sh`
- Modify: `README.md`

**Interfaces:**
- Consumes: built/notarized zips in `dist/`; `scenesearch.version.__version__`; `gh` CLI.

- [ ] **Step 1: Write the publish script**

`packaging/publish_release.sh`:
```bash
#!/usr/bin/env bash
# Publish the current version's notarized zips as a GitHub release.
# Prereqs: both dist zips built (./packaging/build_release.sh and the Intel
# build) and `gh` authenticated.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="gleyzeddonut/scene-search"
VERSION="$(.venv/bin/python -c 'from scenesearch.version import __version__; print(__version__)')"
TAG="v${VERSION}"
ARM="dist/Scene-Search-macOS-arm64.zip"
INTEL="dist/Scene-Search-macOS-x86_64.zip"

for f in "$ARM" "$INTEL"; do
    [ -f "$f" ] || { echo "missing $f — build it first"; exit 1; }
done

echo "==> Publishing $TAG to $REPO"
gh release create "$TAG" "$ARM" "$INTEL" \
    --repo "$REPO" \
    --title "Scene Search ${VERSION}" \
    --notes "Automated release of Scene Search ${VERSION}."
echo "Done: https://github.com/${REPO}/releases/tag/${TAG}"
```
Then: `chmod +x packaging/publish_release.sh`.

- [ ] **Step 2: Create the public repo and push**

Run:
```bash
cd "/Users/dangleyzer/Documents/CLAUDE/scene search"
gh repo create gleyzeddonut/scene-search --public --source=. --remote=origin --push
```
Expected: repo created and the `main` branch pushed. Verify:
Run: `gh repo view gleyzeddonut/scene-search --json url --jq .url`
Expected: prints the repo URL.

- [ ] **Step 3: Build, notarize, and publish the baseline release**

Run (arm64 then Intel then publish):
```bash
./packaging/build_release.sh
VENV=.venv-intel ./packaging/build_release.sh
./packaging/publish_release.sh
```
Expected: both builds Accepted/stapled; `gh release create` prints the release URL. Verify the API the app will read:
Run: `curl -s https://api.github.com/repos/gleyzeddonut/scene-search/releases/latest | grep -E '"tag_name"|browser_download_url'`
Expected: shows `"tag_name": "v1.4.0"` and both zip URLs.

- [ ] **Step 4: End-to-end self-update test (the real proof)**

1. Temporarily bump `scenesearch/version.py` to a fake higher version and publish a throwaway release, so a real 1.4.0 build sees an update:
```bash
# in a scratch step — publish a higher release WITHOUT changing the installed build
gh release create v1.4.1 dist/Scene-Search-macOS-arm64.zip dist/Scene-Search-macOS-x86_64.zip \
    --repo gleyzeddonut/scene-search --title "Scene Search 1.4.1" --notes "test"
```
2. Copy the **1.4.0** build to `~/Applications`:
```bash
ditto -x -k dist/Scene-Search-macOS-arm64.zip /tmp/ss140 && \
  rm -rf ~/Applications/"Scene Search.app" && \
  mv "/tmp/ss140/Scene Search.app" ~/Applications/
```
3. Launch `~/Applications/Scene Search.app`. Confirm by hand:
   - The **"Update available: v1.4.1"** banner appears.
   - Click **Update** → progress → **"Relaunch to finish"**.
   - Click **Relaunch** → app quits, swaps, reopens. Its version is now 1.4.1
     (check **Scene Search ▸ About**, or `mdls -name kMDItemVersion ~/Applications/"Scene Search.app"`).
4. Clean up the throwaway release:
```bash
gh release delete v1.4.1 --repo gleyzeddonut/scene-search --yes --cleanup-tag
```

- [ ] **Step 5: Update the README**

Append to `README.md`:
```markdown
## Updates

When a newer release is published, the app shows an **"Update available"** banner
on launch. Click **Update** to download the new build, then **Relaunch to finish**
— the app swaps itself in and reopens.

For self-update to work, **keep Scene Search in your Applications folder** (drag it
there once). Apps run straight from Downloads are sandboxed by macOS and can't
update themselves; the banner will say so if that happens.

### Cutting a release (maintainer)

```bash
# bump scenesearch/version.py, then:
./packaging/build_release.sh                  # arm64
VENV=.venv-intel ./packaging/build_release.sh # Intel
./packaging/publish_release.sh                # tag + upload to GitHub
```
```

- [ ] **Step 6: Commit**

```bash
git add packaging/publish_release.sh README.md
git commit -m "feat: GitHub release publish flow + update docs"
git push
```

---

## Self-Review

**Spec coverage:**
- Public repo + latest-release API → Tasks 2, 6. ✓
- Single-source version + spec reads it → Task 1. ✓
- Launch check (silent on failure) → Tasks 2, 4, 5. ✓
- Banner + Update→download→verify→Relaunch swap → Tasks 3, 4, 5. ✓
- Frozen-only / translocation message / dev message → Task 5 (`_on_update_available`). ✓
- codesign verify against Team K7VM2MP885 → Task 3 (`verify_bundle`), Task 4 (DownloadWorker). ✓
- ditto unzip (preserve signature) → Task 3 (`unzip_app`). ✓
- Publish step (gh release) → Task 6. ✓
- README → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete; manual steps (ditto/codesign/swap) are explicitly called out as integration-verified in Task 6.

**Type consistency:** `UpdateInfo(version, url, notes)` defined in Task 2, used in Tasks 4/5. `check_for_update`/`is_newer`/`parse_release`/`running_app_bundle`/`is_translocated` signatures consistent Tasks 2→5. `download(url, dest, opener, progress, chunk)`, `unzip_app(zip, dest)->Path|None`, `verify_bundle(app, team_id)`, `write_swap_script(old, new, pid)` consistent Tasks 3→5. `CheckWorker.update_available/no_update` and `DownloadWorker(url)` with `progress/ready/failed` consistent Tasks 4→5. `TEAM_ID="K7VM2MP885"` consistent throughout.
