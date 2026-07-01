// Diagnostic harness (opt-in): run the real PDF pipeline over the whole
// Downloads/Scripts corpus and dump per-file quality signals for offline triage.
// Mirrors Library.parseFile's engine choice (minus OCR). Never fails; run two
// sweeps (before/after a parser change) and diff the JSONs to catch regressions:
//   CORPUS_OUT=/tmp/before.json npx vitest run src/main/engine/_corpus.test.ts
import { it } from 'vitest'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractLayout, layoutToText } from './extract'
import { parseLayout, parseScenes, parseHeadingless, parseScenesHeadingless, parseColonDialogue } from './parser'
import { pickParse } from './library'
import type { Scene } from './types'

const dropEmpty = (scenes: Scene[]) => scenes.filter((s) => s.blocks.length > 0).map((s, i) => ({ ...s, index: i + 1 }))

// suspicious character names: digits, single letters, extraction artifacts
const JUNK_NAME = /\d|^.$|^(INT|EXT|CONT'D|MORE|OMITTED|V\.?O\.?|O\.?S\.?|O\.?C\.?)$/
const OUT = process.env.CORPUS_OUT

it.skipIf(!OUT)('corpus diagnostic sweep', async () => {
  const dir = '/Users/dangleyzer/Downloads/Scripts'
  const files = readdirSync(dir).filter((f) => /\.pdf$/i.test(f))
  const rows: any[] = []
  for (const f of files) {
    const row: any = { file: f }
    try {
      const { lines, pageCount } = await extractLayout(join(dir, f))
      const layoutText = layoutToText(lines)
      const layout = dropEmpty(parseLayout(lines))
      const regex = dropEmpty(parseScenes(layoutText))
      let best = pickParse(layout, regex)
      let engine = best === layout ? 'layout' : 'regex'
      if (best.length === 0) {
        const a = parseScenesHeadingless(layoutText)
        const b = parseHeadingless(lines)
        best = (b[0]?.characters.length ?? 0) > (a[0]?.characters.length ?? 0) ? b : a
        engine = best.length ? 'headingless' : engine
      }
      const dlgCount = (ss: Scene[]) => ss.reduce((n, s) => n + s.lines.length, 0)
      if (best.length === 0 || dlgCount(best) === 0) {
        const colon = parseColonDialogue(layoutText)
        if (dlgCount(colon) > 0) {
          best = colon
          engine = 'colon'
        } else if (best.length === 0) engine = 'none'
      }
      const chars = new Set<string>()
      let dlgLines = 0
      let zeroDlgScenes = 0
      let emptyCueTexts = 0
      for (const s of best) {
        for (const c of s.characters) chars.add(c)
        dlgLines += s.lines.length
        if (!s.lines.length) zeroDlgScenes++
        for (const b of s.blocks) if (b.type === 'cue' && !b.text.trim()) emptyCueTexts++
      }
      Object.assign(row, {
        pageCount,
        engine,
        layoutScenes: layout.length,
        regexScenes: regex.length,
        scenes: best.length,
        dlgLines,
        zeroDlgScenes,
        emptyCueTexts,
        characters: [...chars],
        junkChars: [...chars].filter((c) => JUNK_NAME.test(c)),
        headings: best.map((s) => s.heading).slice(0, 60),
        textChars: layoutText.length
      })
    } catch (e) {
      row.error = String(e)
    }
    rows.push(row)
  }
  writeFileSync(OUT!, JSON.stringify(rows, null, 1))
  console.log(`wrote ${rows.length} rows to ${OUT}`)
}, 1200000)
