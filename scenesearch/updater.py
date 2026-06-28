from __future__ import annotations

import json
import os
import platform
import shlex
import subprocess
import sys
import tempfile
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
    subprocess.run(["ditto", "-x", "-k", str(zip_path), str(dest_dir)], check=True)
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
