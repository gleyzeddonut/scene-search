import { stat, readFile } from 'node:fs/promises'
import { basename, resolve, extname } from 'node:path'
import { extractPaginated as realExtract, extractLayout, layoutToText, isSparsePdf, ocrPdf } from './extract'
import { parseScenes, parseLayout } from './parser'
import { parseFdx, parseFountain } from './formats'
import { scenePairing, guessGender } from './gender'
import { sceneWordCount, estimateSeconds } from './runtime'
import { iterCandidates, SCRIPT_EXTENSIONS } from './scanner'
import type { Scene, SceneMatch, SceneBlock } from './types'

const PAREN_NUM = /\s*\(\d+\)$/
const COPY = /\s+copy(\s+\d+)?$/i

export function canonicalKey(filename: string): string {
  const dot = filename.lastIndexOf('.')
  let stem = dot >= 0 ? filename.slice(0, dot) : filename
  const ext = dot >= 0 ? filename.slice(dot) : ''
  let prev: string | null = null
  while (prev !== stem) {
    prev = stem
    stem = stem.replace(PAREN_NUM, '').replace(COPY, '')
  }
  return (stem.trim() + ext).toLowerCase()
}

interface ScriptRow { path: string; name: string; mtime: number; sceneCount: number; pinned: boolean }
interface SceneRow {
  path: string; name: string; index: number; heading: string; page: number
  charCount: number; characters: string[]; pairing: string | null; est: number
  dialogue: [string, string][]; content: SceneBlock[]
}

interface ReindexOpts {
  ignoreDirs?: string[]
  progress?: (name: string) => void
  shouldCancel?: () => boolean
  onError?: (path: string, err: unknown) => void
}

export class Library {
  private scripts = new Map<string, ScriptRow>()
  private scenes: SceneRow[] = []
  // overridable for tests
  _extract = realExtract

  scriptCount(): number {
    let n = 0
    for (const s of this.scripts.values()) if (s.sceneCount > 0) n++
    return n
  }
  sceneCount(): number {
    return this.scenes.length
  }

  toJSON() {
    return { scripts: [...this.scripts.values()], scenes: this.scenes }
  }
  fromJSON(data: { scripts: ScriptRow[]; scenes: SceneRow[] }) {
    this.scripts = new Map(data.scripts.map((s) => [s.path, s]))
    this.scenes = data.scenes
  }

  // dispatch by format: structured markup (fdx/fountain) parses natively; everything
  // else goes through text extraction. Any read/parse failure yields 0 scenes.
  private async parseFile(rp: string): Promise<Scene[]> {
    const ext = extname(rp).toLowerCase()
    try {
      if (ext === '.fdx') return parseFdx(await readFile(rp, 'utf-8'))
      if (ext === '.fountain') return parseFountain(await readFile(rp, 'utf-8'))
      if (ext === '.pdf') {
        const { lines, pageCount } = await extractLayout(rp)
        const layoutText = layoutToText(lines)
        // one extraction, two parses: prefer layout, but never find fewer scenes
        // than the regex parser (no detection regression)
        const layout = parseLayout(lines)
        const regex = parseScenes(layoutText)
        let best = layout.length >= regex.length ? layout : regex
        // only when a PDF parsed to nothing AND has essentially no text layer (a true
        // scan/photo) do we OCR it (macOS Vision). Never runs on normal text PDFs.
        if (best.length === 0 && pageCount <= 60 && isSparsePdf(layoutText, pageCount)) {
          const ocr = parseScenes(await ocrPdf(rp))
          if (ocr.length > best.length) best = ocr
        }
        return best
      }
      return parseScenes(await this._extract(rp))
    } catch {
      return []
    }
  }

  private async indexFile(path: string): Promise<void> {
    const rp = resolve(path)
    let mtime = 0
    try {
      mtime = (await stat(rp)).mtimeMs
    } catch {
      return
    }
    const existing = this.scripts.get(rp)
    if (existing && Math.abs(existing.mtime - mtime) < 1) return
    const parsed = await this.parseFile(rp)
    this.deleteScript(rp)
    this.scripts.set(rp, { path: rp, name: basename(rp), mtime, sceneCount: parsed.length, pinned: false })
    for (const s of parsed) {
      this.scenes.push({
        path: rp, name: basename(rp), index: s.index, heading: s.heading, page: s.page,
        charCount: s.characters.length, characters: s.characters, pairing: scenePairing(s.characters),
        est: estimateSeconds(sceneWordCount(s.lines)), dialogue: s.lines, content: s.blocks
      })
    }
  }

  private deleteScript(rp: string) {
    this.scripts.delete(rp)
    this.scenes = this.scenes.filter((s) => s.path !== rp)
  }

  async reindex(folders: string[], opts: ReindexOpts = {}): Promise<void> {
    const present = new Set<string>()
    let cancelled = false
    for await (const path of iterCandidates(folders, {
      ignoreDirs: opts.ignoreDirs,
      shouldCancel: opts.shouldCancel,
      onError: opts.onError
    })) {
      if (opts.shouldCancel?.()) { cancelled = true; break }
      present.add(resolve(path))
      try {
        await this.indexFile(path)
      } catch (e) {
        opts.onError?.(path, e) // never let one bad file abort the index
      }
      opts.progress?.(basename(path))
    }
    if (cancelled || opts.shouldCancel?.()) return
    for (const [path, row] of [...this.scripts]) {
      if (!present.has(path) && !row.pinned) this.deleteScript(path)
    }
  }

  query(f: { minChars?: number; maxChars?: number; pairing?: string | null }): SceneMatch[] {
    let rows = this.scenes.filter((s) => {
      if (f.minChars != null && s.charCount < f.minChars) return false
      if (f.maxChars != null && s.charCount > f.maxChars) return false
      if (f.pairing != null && s.pairing !== f.pairing) return false
      return true
    })
    // fold re-download copies: keep the representative (shortest name) per canonical key
    const rep = new Map<string, string>()
    const repName = new Map<string, string>()
    for (const s of rows) {
      const key = canonicalKey(s.name)
      if (!repName.has(key) || s.name.length < repName.get(key)!.length) {
        rep.set(key, s.path)
        repName.set(key, s.name)
      }
    }
    rows = rows.filter((s) => rep.get(canonicalKey(s.name)) === s.path)
    rows.sort((a, b) => (a.name === b.name ? a.index - b.index : a.name < b.name ? -1 : 1))
    return rows.map((s) => ({
      script_path: s.path, script_name: s.name, heading: s.heading, page: s.page,
      char_count: s.charCount, characters: s.characters, pairing: s.pairing,
      scene_index: s.index, est_seconds: s.est
    }))
  }

  getScene(path: string, index: number) {
    const s = this.scenes.find((x) => x.path === path && x.index === index)
    if (!s) return null
    return {
      heading: s.heading,
      characters: s.characters.map((n) => ({ name: n, gender: guessGender(n) })),
      lines: s.dialogue.map(([who, text]) => ({ who, text })),
      content: s.content,
      est_seconds: s.est
    }
  }

  async addFile(path: string): Promise<'added' | 'exists' | 'not_script' | 'unreadable'> {
    const rp = resolve(path)
    const ext = rp.slice(rp.lastIndexOf('.')).toLowerCase()
    if (!SCRIPT_EXTENSIONS.has(ext)) return 'not_script'
    if (this.scripts.has(rp)) return 'exists'
    try {
      await this.indexFile(rp)
    } catch {
      return 'unreadable'
    }
    const row = this.scripts.get(rp)
    if (!row) return 'unreadable'
    if (row.sceneCount === 0) {
      this.deleteScript(rp)
      return 'not_script'
    }
    row.pinned = true
    return 'added'
  }
}
