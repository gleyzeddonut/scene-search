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
