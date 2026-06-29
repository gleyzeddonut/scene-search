# -*- mode: python ; coding: utf-8 -*-
import os
from PyInstaller.utils.hooks import collect_all

PROJECT_ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [(os.path.join(PROJECT_ROOT, "scenesearch", "screenplay", "names_gender.json"),
          "scenesearch/screenplay")]
# pypdf/docx are imported lazily inside functions, so name them explicitly so
# PyInstaller bundles them (a missing pypdf would silently break PDF indexing).
hiddenimports = ["pypdf", "docx", "send2trash"]
for pkg in ("uvicorn", "fastapi", "anyio", "starlette", "pydantic", "pypdf", "docx"):
    d, b, h = collect_all(pkg)
    datas += d
    hiddenimports += h

a = Analysis(
    [os.path.join(PROJECT_ROOT, "packaging", "engine_entry.py")],
    pathex=[PROJECT_ROOT],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["PySide6", "tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="scripty-engine",
          console=True, disable_windowed_traceback=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="scripty-engine")
