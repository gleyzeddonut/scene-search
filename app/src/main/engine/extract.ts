import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { SCENE_RE } from './parser'
import type { LayoutLine } from './types'

export class ExtractionError extends Error {}

const MAX_PAGES = 400
const MAX_CHARS = 400_000
const pExecFile = promisify(execFile)

// Almost no text layer for the page count → the PDF is scanned/photographed images
// (e.g. photographed audition sides), so OCR is worth trying.
export function isSparsePdf(text: string, pageCount: number): boolean {
  return text.length / Math.max(pageCount, 1) < 100
}

// locate the bundled macOS OCR helper without importing electron (engine stays testable)
function ocrBinary(): string | null {
  const cands = [
    process.resourcesPath ? join(process.resourcesPath, 'scripty-ocr') : '',
    join(process.cwd(), 'resources', 'scripty-ocr'),
    join(process.cwd(), 'app', 'resources', 'scripty-ocr')
  ].filter(Boolean)
  return cands.find((p) => existsSync(p)) || null
}

// OCR a scanned PDF via the macOS Vision helper; returns '' if the helper is absent.
export async function ocrPdf(path: string): Promise<string> {
  const bin = ocrBinary()
  if (!bin) return ''
  try {
    const { stdout } = await pExecFile(bin, [path], { maxBuffer: 64 * 1024 * 1024, timeout: 180_000 })
    return stdout.slice(0, MAX_CHARS)
  } catch {
    return ''
  }
}

async function loadPdf(path: string) {
  // legacy build runs in Node; point the fake worker at the resolved worker file
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const require = createRequire(import.meta.url)
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const data = new Uint8Array(await readFile(path))
  // verbosity 0 (errors only) silences pdf.js font/xref console noise like
  // "TT: invalid function id" and "Indexing all PDF objects" — they're harmless
  return pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise
}

// Diagonal/tiled watermarks (common on audition sides — an actor-ID stamp like
// "827559 - Jan 10, 2026 10:45 AM" repeated across the page, or "JESSICA ALBANO-"
// tiled) come out of the text layer as one line that is the same token repeated
// many times. Detect that so we can drop it before it pollutes dialogue.
export function isRepeatWatermark(s: string): boolean {
  const t = s.trim()
  if (t.length < 40) return false
  // Emphatic dialogue repeats words too ("Stop lying. Stop lying. Stop lying…"),
  // so repetition alone isn't enough. A tiled stamp is either an ID/timestamp
  // (has digits) or an all-caps name stamp — natural sentence-case prose is
  // neither, so it's preserved.
  if (!/\d/.test(t) && /[a-z]/.test(t)) return false
  const tokens = t.split(/[\s\-–—,:.]+/).filter((w) => w.length >= 4)
  if (tokens.length < 4) return false
  const counts = new Map<string, number>()
  for (const w of tokens) counts.set(w, (counts.get(w) || 0) + 1)
  const max = Math.max(...counts.values())
  // a long word repeated 4× — or 3× while most tokens are repeats — is a stamp
  return max >= 4 || (max >= 3 && tokens.length >= 6 && counts.size <= tokens.length / 2)
}

// group a page's text items into lines (by rounded y), each tagged with its left x
// and its baseline y (PDF points, bottom-left origin) for scroll-to-scene
function pageLines(content: any): { text: string; x: number; y: number }[] {
  const rows = new Map<number, { x: number; s: string }[]>()
  for (const it of content.items as any[]) {
    if (typeof it.str !== 'string') continue
    const y = Math.round(it.transform[5])
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y)!.push({ x: it.transform[4], s: it.str })
  }
  const ys = [...rows.keys()].sort((a, b) => b - a)
  return ys
    .map((y) => {
      const items = rows.get(y)!.sort((a, b) => a.x - b.x)
      return { text: items.map((r) => r.s).join('').trimEnd(), x: items.length ? items[0].x : 0, y }
    })
    .filter((ln) => !isRepeatWatermark(ln.text))
}

// only digits, dots and spaces (gutter scene numbers / page numbers: "17 17", "7.")
const PAGENUM_LINE = /^[\d.\s]*\d[\d.\s]*$/
// "BEGIN SCENE 2" / "END SCENE 2:" — scene delimiters some sides use; may be glued
// onto a character cue that shares the same text baseline ("MOIRAEND SCENE 1")
const SCENE_MARKER_RE = /(BEGIN|END)\s+SCENE\s+(\d+[A-Za-z]?)\s*:?/i
// recurrence key for running headers/footers: letters only, so a page-number or
// date that drifts ("12.19.2 5" vs "12.19.25") still collapses to the same slug
const headerKey = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
// the standard audition-sides footer ("Sides by Breakdown Services - Actors
// Access …") stamped on every page — never script content, and often glued onto a
// real line, so strip it and everything after it. We require the "Sides by …"
// signature (which no character ever speaks) rather than a bare "Actors Access", so
// a line of dialogue that merely mentions the platform is left intact.
const SIDES_FOOTER_RE = /\s*Sides by (?:Breakdown Services|Actors Access|Showfax)\b.*$/i
// a recurring line is page furniture (a production slug/footer) only if it reads
// like one — a colour-revision/draft/production marker or a date. A coincidentally
// repeated line of real dialogue won't match, sparing it on short docs where the
// recurrence threshold is only two pages.
const FURNITURE_RE =
  /\b(?:draft|revision|rev\.|production|omitted|cont(?:inued|'d)?|white|blue|pink|yellow|green|goldenrod|cherry|salmon|buff|tan)\b|\d{1,2}[./]\d{1,2}[./]\d{2,4}/i

// Strip extraction noise from the layout stream so it doesn't pollute parsing:
//  • running headers/footers (a digit-bearing slug repeated across pages)
//  • gutter scene numbers and page numbers
//  • BEGIN/END SCENE markers — converted to a real scene boundary when they're the
//    only delimiter (sides without INT./EXT.), dropped when redundant beside a slug
export function cleanLayout(lines: LayoutLine[]): LayoutLine[] {
  // count, per normalized slug, how many distinct pages it appears on. Use the same
  // footer-stripped text the lookup below uses, so the build key and lookup key
  // can't diverge.
  const norm = (l: LayoutLine) => l.text.replace(SIDES_FOOTER_RE, '').trim()
  const pagesByKey = new Map<string, Set<number>>()
  for (const l of lines) {
    const t = norm(l)
    if (t.length < 15 || !/\d/.test(t) || SCENE_RE.test(t)) continue
    const k = headerKey(t)
    if (k.length < 6) continue
    if (!pagesByKey.has(k)) pagesByKey.set(k, new Set())
    pagesByKey.get(k)!.add(l.page)
  }
  const totalPages = new Set(lines.map((l) => l.page)).size
  const thresh = totalPages <= 3 ? 2 : 3
  // on short docs the threshold is only two pages, so also require the line to read
  // like production furniture — otherwise a coincidentally-repeated real line (a
  // refrain, a restated beat) would be deleted from every page it appears on
  const gateFurniture = totalPages <= 3
  const isRunningHeader = (t: string) =>
    t.length >= 15 &&
    /\d/.test(t) &&
    !SCENE_RE.test(t) &&
    (pagesByKey.get(headerKey(t))?.size ?? 0) >= thresh &&
    (!gateFurniture || FURNITURE_RE.test(t))

  // a real INT./EXT. slug within the next few lines means a BEGIN marker is just
  // redundant labelling for that slug's scene → don't promote it to a heading
  const slugAhead = (i: number): boolean => {
    let seen = 0
    for (let j = i + 1; j < lines.length && seen < 4; j++) {
      const s = norm(lines[j])
      if (!s) continue
      seen++
      if (SCENE_RE.test(s)) return true
    }
    return false
  }

  // reduce, not Math.min(...spread) — the spread blows the call-arg limit on very
  // large PDFs (a RangeError that parseFile would swallow into a 0-scene index)
  const leftX = lines.reduce((m, l) => Math.min(m, l.x), Infinity)
  const out: LayoutLine[] = []
  let sinceHeading = Infinity // kept lines since the last real INT./EXT. slug
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const text = l.text.replace(SIDES_FOOTER_RE, '')
    const t = text.trim()
    if (!t) continue
    // pure-number lines are gutter scene numbers / page numbers ("17 17", "7."). A
    // dialogue line that is solely a bare number doesn't occur in real scripts, and
    // a position-based exception reintroduced gutter-number pollution, so drop them.
    if (PAGENUM_LINE.test(t)) continue
    if (isRunningHeader(t)) continue

    const m = t.match(SCENE_MARKER_RE)
    // only a real boundary marker, which sits at the start or end of the line
    // (standalone, or glued to a cue like "MOIRAEND SCENE 1"). A match with prose
    // on BOTH sides is just a sentence that mentions "begin scene N" — leave it.
    const before = m ? t.slice(0, m.index!).trim() : ''
    const after = m ? t.slice(m.index! + m[0].length).trim() : ''
    if (m && !(before && after)) {
      const rest = (before + ' ' + after).trim()
      // promote a BEGIN marker to a heading only when it's the scene's only
      // delimiter: no slug recently before it AND none just ahead of it
      if (m[1].toUpperCase() === 'BEGIN' && sinceHeading > 6 && !slugAhead(i)) {
        out.push({ text: `SCENE ${m[2]}`, x: leftX, y: l.y, page: l.page })
        sinceHeading = Infinity
      }
      if (rest) {
        out.push({ text: rest, x: l.x, y: l.y, page: l.page })
        sinceHeading++
      }
      continue
    }

    out.push({ text, x: l.x, y: l.y, page: l.page })
    sinceHeading = SCENE_RE.test(t) ? 0 : sinceHeading + 1
  }
  return out
}

// Layout-aware extraction: lines with their left-x position (for indentation-based
// parsing) plus the PDF's real page count (for scanned-PDF detection).
export async function extractLayout(path: string): Promise<{ lines: LayoutLine[]; pageCount: number }> {
  const doc = await loadPdf(path)
  const out: LayoutLine[] = []
  const pageCount = doc.numPages
  const pages = Math.min(pageCount, MAX_PAGES)
  let chars = 0
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i)
    for (const ln of pageLines(await page.getTextContent())) {
      out.push({ text: ln.text, x: ln.x, y: ln.y, page: i })
      chars += ln.text.length
      if (chars >= MAX_CHARS) return { lines: cleanLayout(out), pageCount }
    }
  }
  return { lines: cleanLayout(out), pageCount }
}

// Reconstruct the flat paginated text from layout lines (matches extractPaginated),
// so the regex parser can run from the same single extraction as the layout parser.
export function layoutToText(lines: LayoutLine[]): string {
  if (!lines.length) return ''
  let out = ''
  let page = lines[0].page
  for (const l of lines) {
    if (l.page !== page) {
      out += '\f\n'
      page = l.page
    }
    out += l.text + '\n'
  }
  return out.slice(0, MAX_CHARS)
}

async function extractPdf(path: string): Promise<string> {
  const doc = await loadPdf(path)
  const parts: string[] = []
  const pages = Math.min(doc.numPages, MAX_PAGES)
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i)
    parts.push(pageLines(await page.getTextContent()).map((l) => l.text).join('\n'))
    if (parts.reduce((n, p) => n + p.length, 0) >= MAX_CHARS) break
  }
  // join pages with form-feed + newline so a heading at the top of a page is its
  // own line (not glued to the previous page's last line) — \f still marks pages
  return parts.join('\f\n').slice(0, MAX_CHARS)
}

async function extractDocx(path: string): Promise<string> {
  const mammoth: any = await import('mammoth')
  const { value } = await mammoth.extractRawText({ path })
  return String(value).slice(0, MAX_CHARS)
}

async function extractFdx(path: string): Promise<string> {
  const { XMLParser } = await import('fast-xml-parser')
  const xml = await readFile(path, 'utf-8')
  const parser = new XMLParser({ ignoreAttributes: true, textNodeName: '#text' })
  const tree = parser.parse(xml)
  const texts: string[] = []
  const walk = (node: any): void => {
    if (node == null) return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'Text') {
          if (Array.isArray(v)) v.forEach((x) => texts.push(typeof x === 'string' ? x : (x?.['#text'] ?? '')))
          else texts.push(typeof v === 'string' ? v : ((v as any)?.['#text'] ?? ''))
        } else walk(v)
      }
    }
  }
  walk(tree)
  return texts.filter(Boolean).join('\n').slice(0, MAX_CHARS)
}

export async function extractPaginated(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()
  try {
    if (ext === '.pdf') return await extractPdf(path)
    if (ext === '.docx') return await extractDocx(path)
    if (ext === '.fdx') return await extractFdx(path)
    if (ext === '.txt' || ext === '.fountain') return (await readFile(path, 'utf-8')).slice(0, MAX_CHARS)
  } catch (e) {
    throw new ExtractionError(`${path}: ${(e as Error).message}`)
  }
  throw new ExtractionError(`${path}: unsupported extension '${ext}'`)
}
