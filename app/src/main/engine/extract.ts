import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { createRequire } from 'node:module'
import type { LayoutLine } from './types'

export class ExtractionError extends Error {}

const MAX_PAGES = 400
const MAX_CHARS = 400_000

async function loadPdf(path: string) {
  // legacy build runs in Node; point the fake worker at the resolved worker file
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const require = createRequire(import.meta.url)
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const data = new Uint8Array(await readFile(path))
  return pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise
}

// group a page's text items into lines (by rounded y), each tagged with its left x
function pageLines(content: any): { text: string; x: number }[] {
  const rows = new Map<number, { x: number; s: string }[]>()
  for (const it of content.items as any[]) {
    if (typeof it.str !== 'string') continue
    const y = Math.round(it.transform[5])
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y)!.push({ x: it.transform[4], s: it.str })
  }
  const ys = [...rows.keys()].sort((a, b) => b - a)
  return ys.map((y) => {
    const items = rows.get(y)!.sort((a, b) => a.x - b.x)
    return { text: items.map((r) => r.s).join('').trimEnd(), x: items.length ? items[0].x : 0 }
  })
}

// Layout-aware extraction: lines with their left-x position, for indentation-based parsing.
export async function extractLayout(path: string): Promise<LayoutLine[]> {
  const doc = await loadPdf(path)
  const out: LayoutLine[] = []
  const pages = Math.min(doc.numPages, MAX_PAGES)
  let chars = 0
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i)
    for (const ln of pageLines(await page.getTextContent())) {
      out.push({ text: ln.text, x: ln.x, page: i })
      chars += ln.text.length
      if (chars >= MAX_CHARS) return out
    }
  }
  return out
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
