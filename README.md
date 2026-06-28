# Scene Search

A native macOS app that finds movie/TV scripts scattered across your drive,
confirms them by reading inside the files, lists them, and lets you copy, move,
rename, open, or trash them.

## Setup

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## Run

```bash
.venv/bin/python app.py
```

## What it scans

By default: Downloads, Desktop, Documents, and iCloud Drive Documents. Use
**Add Folder…** in the app to point it anywhere else your scripts live
(e.g. a `~/Movies/Scripts` folder, an external drive under `/Volumes/…`, etc.).
It looks at `.pdf .fountain .fdx .txt .docx` files and only lists the ones that
read like screenplays (INT./EXT. headings, FADE IN, character cues, etc.).

## Selecting and moving files

Click a row to act on one file, or ⌘-click / shift-click to select several. The
**Copy to…**, **Move to…**, and **Delete to Trash** buttons act on every
selected file at once. In the Copy/Move folder picker, use the **New Folder**
button to create a fresh destination folder and move the batch straight into it.
Moved and trashed files drop out of the list immediately.

## Notes

- Delete always moves files to the Trash — never a permanent delete.
- Scanned/image-only PDFs have no extractable text, so they can't be detected
  (the "couldn't read" count in the status bar reflects these).
- After renaming/moving/deleting from the app, click **Scan** again to refresh.

## Development

```bash
.venv/bin/python -m pytest        # run the test suite (GUI-free core)
```

The core (`scenesearch/`) has no Qt dependency and is fully unit-tested; the Qt
layer (`scenesearch/ui/`, `app.py`) is a thin shell over it.

## Releases

`./packaging/build_release.sh` builds, Developer-ID-signs, notarizes, staples,
and zips a distributable `.app`. It produces a zip named by the built
architecture:

- **Apple Silicon (M1/M2/M3/M4):** `dist/Scene-Search-macOS-arm64.zip`
- **Intel:** `dist/Scene-Search-macOS-x86_64.zip`

The default (arm64) build uses `.venv`. The Intel build uses an x86_64 Python
venv (`.venv-intel`, created with `uv`) and runs through Rosetta:

```bash
# one-time: create the x86_64 venv
uv python install cpython-3.13.12-macos-x86_64-none
uv venv --python cpython-3.13.12-macos-x86_64-none .venv-intel
uv pip install --python .venv-intel/bin/python -r requirements.txt pyinstaller

# build the Intel release
VENV=.venv-intel ./packaging/build_release.sh
```
