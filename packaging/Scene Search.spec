# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Scene Search.
# Build from the project root with:
#   .venv/bin/pyinstaller "packaging/Scene Search.spec" --noconfirm

import os

block_cipher = None

PROJECT_ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

import sys as _sys
if PROJECT_ROOT not in _sys.path:
    _sys.path.insert(0, PROJECT_ROOT)
from scenesearch.version import __version__ as APP_VERSION

a = Analysis(
    [os.path.join(PROJECT_ROOT, "app.py")],
    pathex=[PROJECT_ROOT],
    binaries=[],
    datas=[
        (
            os.path.join(PROJECT_ROOT, "scenesearch", "screenplay", "names_gender.json"),
            "scenesearch/screenplay",
        ),
        (
            os.path.join(PROJECT_ROOT, "scenesearch", "fonts"),
            "scenesearch/fonts",
        ),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Scene Search",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Scene Search",
)

app = BUNDLE(
    coll,
    name="Scene Search.app",
    icon=None,
    bundle_identifier="com.gleyzer.scenesearch",
    info_plist={
        "CFBundleName": "Scene Search",
        "CFBundleDisplayName": "Scene Search",
        "CFBundleShortVersionString": APP_VERSION,
        "CFBundleVersion": APP_VERSION,
        "LSMinimumSystemVersion": "13.0",
        "NSHighResolutionCapable": True,
        "NSHumanReadableCopyright": "© 2026 Daniel Gleyzer",
    },
)
