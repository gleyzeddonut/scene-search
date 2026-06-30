import { stat, readFile } from 'node:fs/promises'
import { basename, resolve, extname, dirname } from 'node:path'
import { extractPaginated as realExtract, extractLayout, layoutToText, isSparsePdf, ocrPdf } from './extract'
import { parseScenes, parseLayout, parseHeadingless, parseScenesHeadingless } from './parser'
import { parseFdx, parseFountain } from './formats'
import { scenePairing, guessGender, pairingFromGenders } from './gender'
import { sceneWordCount, estimateSeconds, estimateScene } from './runtime'
import { iterCandidates, SCRIPT_EXTENSIONS } from './scanner'
import type { Scene, SceneMatch, SceneBlock } from './types'

const PAREN_NUM = /\s*\(\d+\)$/
const COPY = /\s+copy(\s+\d+)?$/i

// Drop scenes with no content at all (no dialogue AND no action) — a bare heading or
// a "SCENE n" section label sitting right before a real INT./EXT. slug. Scenes with
// action but no dialogue are kept. Re-number so scene_index stays contiguous (the UI
// navigates by index).
function dropEmpty(scenes: Scene[]): Scene[] {
  return scenes.filter((s) => s.blocks.length > 0).map((s, i) => ({ ...s, index: i + 1 }))
}

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

interface ScriptRow { path: string; name: string; mtime: number; added?: number; sceneCount: number; pinned: boolean; medium?: string }

// A deliberately conservative medium guess: only auto-tag 'Commercial' when the
// document essentially SAYS so — its filename contains "commercial", or the text uses
// "commercial" as an explicit label ("COMMERCIAL AUDITION", "TV COMMERCIAL", ":30
// COMMERCIAL"). The bare word in prose is NOT enough (feature scripts say "commercial
// flight" etc. — verified false positives across the corpus). We never guess
// TV/Play/Film: audition sides are excerpts and don't reveal those.
// the ":\d\d COMMERCIAL" form is split out without a leading \b — a word boundary
// before ":" fails when it's preceded by a space, which would make that branch dead
const COMMERCIAL_LABEL_RE =
  /\bCOMMERCIAL\s+(?:AUDITION|SPOT|SCRIPT|STORYBOARD|BREAKDOWN)\b|\b(?:TV|RADIO|NATIONAL|REGIONAL)\s+COMMERCIAL\b|:\d\d\s+COMMERCIAL\b/
function guessMedium(name: string, scenes: { heading: string; blocks: SceneBlock[] }[]): string | undefined {
  // normalize separators first ("Wawa_Commercial_Sides" → "Wawa Commercial Sides"),
  // since '_' is a word char and would defeat the \b boundary
  if (/\bcommercials?\b/i.test(name.replace(/[^a-zA-Z]+/g, ' '))) return 'Commercial'
  const hay = scenes
    .map((s) => s.heading + ' ' + s.blocks.map((b) => b.text).join(' '))
    .join(' ')
    .toUpperCase()
  return COMMERCIAL_LABEL_RE.test(hay) ? 'Commercial' : undefined
}
interface SceneRow {
  path: string; name: string; index: number; heading: string; page: number; top?: number
  charCount: number; characters: string[]; pairing: string | null; est: number
  dialogue: [string, string][]; content: SceneBlock[]
}

interface ReindexOpts {
  ignoreDirs?: string[]
  ignoreFiles?: Set<string> // resolved paths the user removed — never re-add them
  progress?: (name: string) => void
  shouldCancel?: () => boolean
  onError?: (path: string, err: unknown) => void
  // re-parse every file even if its mtime is unchanged (used after a parser
  // upgrade or an explicit "Rebuild library")
  force?: boolean
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
  fromJSON(data: { scripts?: ScriptRow[]; scenes?: SceneRow[] }) {
    // tolerate a malformed/old-shape index.json (loadIndex only catches parse errors)
    // rather than throwing — a throw here would leave the engine half-built
    this.scripts = new Map((Array.isArray(data?.scripts) ? data.scripts : []).map((s) => [s.path, s]))
    this.scenes = Array.isArray(data?.scenes) ? data.scenes : []
  }

  // dispatch by format: structured markup (fdx/fountain) parses natively; everything
  // else goes through text extraction. Any read/parse failure yields 0 scenes.
  private async parseFile(rp: string): Promise<Scene[]> {
    const ext = extname(rp).toLowerCase()
    try {
      if (ext === '.fdx') return dropEmpty(parseFdx(await readFile(rp, 'utf-8')))
      if (ext === '.fountain') return dropEmpty(parseFountain(await readFile(rp, 'utf-8')))
      if (ext === '.pdf') {
        const { lines, pageCount } = await extractLayout(rp)
        const layoutText = layoutToText(lines)
        // one extraction, two parses: prefer layout, but never find fewer scenes
        // than the regex parser (no detection regression). Drop content-less scenes
        // first — a doc that labels sections "SCENE 1" AND uses INT./EXT. slugs would
        // otherwise yield an empty scene for each bare label.
        const layout = dropEmpty(parseLayout(lines))
        const regex = dropEmpty(parseScenes(layoutText))
        let best = layout.length >= regex.length ? layout : regex
        // sides with dialogue but no slug line at all → synthesize one scene so the
        // content is still searchable (gated to real dialogue, so prose stays empty).
        // try both engines: the text parser is robust when a title page throws off
        // the layout parser's margin detection
        if (best.length === 0) {
          best = [parseScenesHeadingless(layoutText), parseHeadingless(lines)].reduce(
            (a, b) => ((b[0]?.characters.length ?? 0) > (a[0]?.characters.length ?? 0) ? b : a)
          )
        }
        // only when a PDF parsed to nothing AND has essentially no text layer (a true
        // scan/photo) do we OCR it (macOS Vision). Never runs on normal text PDFs.
        if (best.length === 0 && pageCount <= 60 && isSparsePdf(layoutText, pageCount)) {
          const ocr = parseScenes(await ocrPdf(rp))
          if (ocr.length > best.length) best = ocr
        }
        return best
      }
      const flat = await this._extract(rp)
      const scenes = dropEmpty(parseScenes(flat))
      return scenes.length ? scenes : parseScenesHeadingless(flat)
    } catch {
      return []
    }
  }

  private async indexFile(path: string, force = false): Promise<void> {
    const rp = resolve(path)
    let mtime = 0
    let added: number | undefined
    try {
      const st = await stat(rp)
      mtime = st.mtimeMs
      added = st.birthtimeMs || st.mtimeMs // file creation = download/added time (mtime fallback)
    } catch {
      return
    }
    const existing = this.scripts.get(rp)
    if (!force && existing && Math.abs(existing.mtime - mtime) < 1) return
    const parsed = await this.parseFile(rp)
    this.deleteScript(rp)
    // preserve a user's pin across re-parses — a forced rebuild bypasses the
    // mtime early-return that used to shield it, and the orphan-cleanup pass
    // deletes unpinned scripts that fall outside the indexed folders
    const name = basename(rp)
    this.scripts.set(rp, {
      path: rp, name, mtime, added, sceneCount: parsed.length, pinned: existing?.pinned ?? false,
      medium: guessMedium(name, parsed) // conservative auto-tag; undefined unless clearly a commercial
    })
    for (const s of parsed) {
      this.scenes.push({
        path: rp, name: basename(rp), index: s.index, heading: s.heading, page: s.page, top: s.topY,
        charCount: s.characters.length, characters: s.characters, pairing: scenePairing(s.characters),
        est: estimateSeconds(sceneWordCount(s.lines)), dialogue: s.lines, content: s.blocks
      })
    }
  }

  private deleteScript(rp: string) {
    this.scripts.delete(rp)
    this.scenes = this.scenes.filter((s) => s.path !== rp)
  }

  // a file was renamed on disk — move its row + scenes to the new path in place,
  // keeping the parsed data and pin (no re-parse, content is unchanged)
  renamePath(oldPath: string, newPath: string) {
    const row = this.scripts.get(oldPath)
    if (!row) return
    const name = basename(newPath)
    this.scripts.delete(oldPath)
    for (const s of this.scenes)
      if (s.path === oldPath) {
        s.path = newPath
        s.name = name
      }
    // re-guess the medium for the NEW name (the filename feeds the commercial guess,
    // so a rename can change it; the scene text is unchanged)
    const scenes = this.scenes.filter((s) => s.path === newPath).map((s) => ({ heading: s.heading, blocks: s.content }))
    this.scripts.set(newPath, { ...row, path: newPath, name, medium: guessMedium(name, scenes) })
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
      const rp = resolve(path)
      if (opts.ignoreFiles?.has(rp)) continue // user removed this file — don't re-add it
      present.add(rp)
      try {
        await this.indexFile(path, opts.force)
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

  // paths of real scripts (scenes > 0), for bulk ops like move-all — matches the
  // "N scripts" count the UI shows, so the move doesn't relocate 0-scene junk files
  allPaths(): string[] {
    return [...this.scripts.values()].filter((s) => s.sceneCount > 0).map((s) => s.path)
  }

  // the conservative parsed medium guess for a script (only ever 'Commercial' or undefined)
  scriptMedium(path: string): string | undefined {
    return this.scripts.get(path)?.medium
  }

  // distinct character names across a script's scenes (for the Edit-details modal)
  scriptCharacters(path: string): string[] {
    const seen = new Set<string>()
    for (const s of this.scenes) if (s.path === path) for (const c of s.characters) seen.add(c)
    return [...seen]
  }

  // genderOf(path, name) resolves a character's gender (lets manual overrides drive
  // the W/M chips and the W+M/W+W/M+M pairing); defaults to the name-based guess
  query(
    f: { minChars?: number; maxChars?: number; pairing?: string | null },
    genderOf: (path: string, name: string) => string = (_p, n) => guessGender(n)
  ): SceneMatch[] {
    const pcache = new Map<SceneRow, string | null>() // compute each scene's pairing once
    const pairingOf = (s: SceneRow) => {
      if (pcache.has(s)) return pcache.get(s)!
      const p = pairingFromGenders(s.characters.map((n) => genderOf(s.path, n)))
      pcache.set(s, p)
      return p
    }
    let rows = this.scenes.filter((s) => {
      if (f.minChars != null && s.charCount < f.minChars) return false
      if (f.maxChars != null && s.charCount > f.maxChars) return false
      if (f.pairing != null && pairingOf(s) !== f.pairing) return false
      return true
    })
    // fold re-download copies: keep the representative (shortest name) per canonical
    // key, scoped to the FOLDER — a re-download ("Heat (1).pdf") sits beside its
    // original, whereas two distinct scripts that merely share a name in different
    // folders must both stay visible
    const foldKey = (s: SceneRow) => dirname(s.path) + '\0' + canonicalKey(s.name)
    const rep = new Map<string, string>()
    const repName = new Map<string, string>()
    for (const s of rows) {
      const key = foldKey(s)
      if (!repName.has(key) || s.name.length < repName.get(key)!.length) {
        rep.set(key, s.path)
        repName.set(key, s.name)
      }
    }
    rows = rows.filter((s) => rep.get(foldKey(s)) === s.path)
    rows.sort((a, b) => (a.name === b.name ? a.index - b.index : a.name < b.name ? -1 : 1))
    return rows.map((s) => {
      const row = this.scripts.get(s.path)
      return {
        script_path: s.path, script_name: s.name, heading: s.heading, page: s.page, top: s.top,
        char_count: s.charCount, characters: s.characters, pairing: pairingOf(s),
        scene_index: s.index, est_seconds: estimateScene(s.dialogue, s.content),
        added: row?.added ?? row?.mtime // creation time; mtime fallback for pre-reindex entries
      }
    })
  }

  getScene(path: string, index: number, genderOf: (path: string, name: string) => string = (_p, n) => guessGender(n)) {
    const s = this.scenes.find((x) => x.path === path && x.index === index)
    if (!s) return null
    return {
      heading: s.heading,
      characters: s.characters.map((n) => ({ name: n, gender: genderOf(path, n) })),
      lines: s.dialogue.map(([who, text]) => ({ who, text })),
      content: s.content,
      est_seconds: estimateScene(s.dialogue, s.content) // action fallback so it's never 0:00
    }
  }

  // drop a script and its scenes from the index
  remove(path: string): boolean {
    const rp = resolve(path)
    if (!this.scripts.has(rp)) return false
    this.deleteScript(rp)
    return true
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
