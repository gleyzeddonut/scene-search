# Parsing / Engine Improvements

Goal: raise parsing accuracy and recover the ~16 zero-scene files found in the
278-file library test. Each phase is TDD (vitest) and committed independently.

## Phase 1 — Native FDX / Fountain parsing
Parse the explicit markup instead of regex-on-flattened-text.
- `formats.ts`: `parseFdx(xml)` (uses `<Paragraph Type=...>`), `parseFountain(text)`
  (forced `.heading` / `@character` / `>transition`, blank-line rules).
- `library.ts`: dispatch by extension (.fdx → parseFdx, .fountain → parseFountain).
- Tests: scene/character/dialogue extraction for both.

## Phase 2 — Layout-aware PDF parsing (foundational)
Use x-position/indentation to classify elements instead of ALL-CAPS regex.
- `extract.ts`: `extractLayout(path)` → lines tagged with left-x + page.
- `parser.ts`: `parseLayout(lines)` — compute the document base margin, classify
  each line (heading/action flush-left, dialogue indented, character cue centered,
  parenthetical, transition right) by x relative to base.
- `library.ts`: .pdf → extractLayout → parseLayout (fallback to text parse if no positions).
- Tests: synthetic positioned lines → correct classification.

## Phase 3 — Smarter scene headings
Recognize beyond INT./EXT.: standalone ALL-CAPS location lines (esp. after
FADE IN/CUT TO or with - DAY/- NIGHT/- CONTINUOUS suffixes), `SCENE N`.
Combine with Phase-2 indentation to avoid false positives.
- Extend `parseScenes`/`parseLayout` heading detection. Tests for each pattern.

## Phase 4 — OCR fallback for scanned PDFs (macOS Vision)
When a PDF yields little text for its page count, OCR it.
- `packaging/ocr/ocr.swift`: PDFKit renders pages → Vision VNRecognizeTextRequest → text.
  Compiled in build, signed, bundled as an extraResource; invoked via child_process.
- `extract.ts`: detect low-text PDFs, shell to the helper, feed result to the parser.
- Tests: integration on a scanned fixture (skipped if helper absent in dev).

## Verify
Re-run the 278-file diff (TS vs the metrics) after each phase; zero-scene count
should drop. Keep all engine vitest tests green.
