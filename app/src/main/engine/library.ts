import { stat, readFile } from 'node:fs/promises'
import { basename, resolve, extname, dirname } from 'node:path'
import { extractPaginated as realExtract, extractLayout, layoutToText, isSparsePdf, ocrPdf } from './extract'
import { parseScenes, parseLayout, parseHeadingless, parseScenesHeadingless, parseColonDialogue } from './parser'
import { parseFdx, parseFountain } from './formats'
import { scenePairing, guessGender, pairingFromGenders } from './gender'
import { sceneWordCount, estimateSeconds, estimateScene, sceneMonologue } from './runtime'
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

// Choose between the layout parse and the regex parse of the same PDF: more scenes
// wins; on a tie, more captured dialogue wins (single-column PDFs give the layout
// parser no indentation to work with, so it finds the scenes but none of the spoken
// lines); a full tie keeps the layout parse, which carries topY for scroll-to-scene.
const dialogueCount = (ss: Scene[]) => ss.reduce((n, s) => n + s.lines.length, 0)
export function pickParse(layout: Scene[], regex: Scene[]): Scene[] {
  if (layout.length !== regex.length) return layout.length > regex.length ? layout : regex
  return dialogueCount(layout) >= dialogueCount(regex) ? layout : regex
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
    this.monoCache = null
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
        let best = pickParse(layout, regex)
        // sides with dialogue but no slug line at all → synthesize one scene so the
        // content is still searchable (gated to real dialogue, so prose stays empty).
        // try both engines: the text parser is robust when a title page throws off
        // the layout parser's margin detection
        if (best.length === 0) {
          best = [parseScenesHeadingless(layoutText), parseHeadingless(lines)].reduce(
            (a, b) => ((b[0]?.characters.length ?? 0) > (a[0]?.characters.length ?? 0) ? b : a)
          )
        }
        // inline "MOM: dialogue" scripts the other parsers can't see — also worth
        // trying when scenes parsed but NO dialogue did (colon scripts with real slugs)
        if (best.length === 0 || dialogueCount(best) === 0) {
          const colon = parseColonDialogue(layoutText)
          if (dialogueCount(colon) > 0) best = colon
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
      if (scenes.length && dialogueCount(scenes) > 0) return scenes
      const headingless = scenes.length ? [] : parseScenesHeadingless(flat)
      if (headingless.length) return headingless
      const colon = parseColonDialogue(flat)
      return colon.length ? colon : scenes
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
    this.monoCache = null // scenes changed
  }

  private deleteScript(rp: string) {
    this.scripts.delete(rp)
    this.scenes = this.scenes.filter((s) => s.path !== rp)
    this.monoCache = null
  }

  // a file was renamed on disk — move its row + scenes to the new path in place,
  // keeping the parsed data and pin (no re-parse, content is unchanged)
  renamePath(oldPath: string, newPath: string) {
    const row = this.scripts.get(oldPath)
    if (!row) return
    this.monoCache = null // path key changes
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

  // each script's biggest monologue (longest single-character speech across its scenes),
  // as { who, seconds }. Cached; the cache is cleared whenever the index changes.
  private monoCache: Map<string, { who: string; seconds: number; scene: number }> | null = null
  scriptMonologues(): Map<string, { who: string; seconds: number; scene: number }> {
    if (this.monoCache) return this.monoCache
    const m = new Map<string, { who: string; seconds: number; scene: number }>()
    for (const s of this.scenes) {
      const mono = sceneMonologue(s.content) // null unless the scene is carried by one voice
      if (!mono) continue
      const cur = m.get(s.path)
      if (!cur || mono.seconds > cur.seconds) m.set(s.path, { ...mono, scene: s.index })
    }
    return (this.monoCache = m)
  }

  // genderOf(path, name) resolves a character's gender (lets manual overrides drive
  // the W/M chips and the W+M/W+W/M+M pairing); defaults to the name-based guess
  query(
    f: { minChars?: number; maxChars?: number; pairing?: string | null; monologue?: boolean },
    genderOf: (path: string, name: string) => string = (_p, n) => guessGender(n)
  ): SceneMatch[] {
    // Size + pairing are SCRIPT-level now that Browse lists whole scripts (not scenes):
    // a script's cast is the distinct speaking characters across ALL of its scenes, so
    // "Duet" means a two-person script, not a script that merely contains a 2-hander scene.
    const castByScript = new Map<string, string[]>()
    const seen = new Map<string, Set<string>>()
    for (const s of this.scenes) {
      let set = seen.get(s.path)
      if (!set) { seen.set(s.path, (set = new Set())); castByScript.set(s.path, []) }
      for (const c of s.characters) if (!set.has(c)) { set.add(c); castByScript.get(s.path)!.push(c) }
    }
    const spCache = new Map<string, string | null>()
    const scriptPairing = (path: string) => {
      let p = spCache.get(path)
      if (p === undefined) spCache.set(path, (p = pairingFromGenders((castByScript.get(path) || []).map((n) => genderOf(path, n)))))
      return p
    }
    // scene-level pairing is still shown per-scene in the preview/navigator tag
    const scCache = new Map<SceneRow, string | null>()
    const pairingOf = (s: SceneRow) => {
      let p = scCache.get(s)
      if (p === undefined) scCache.set(s, (p = pairingFromGenders(s.characters.map((n) => genderOf(s.path, n)))))
      return p
    }
    // each script's longest monologue (its biggest single-character speech across all
    // scenes) — for the "Monologue" filter and the row hint. Only the Monologue filter
    // reads it, so skip the scan (and the per-row payload) for every other query.
    const monoByScript = f.monologue ? this.scriptMonologues() : null
    let rows = this.scenes.filter((s) => {
      const size = (castByScript.get(s.path) || []).length
      if (f.minChars != null && size < f.minChars) return false
      if (f.maxChars != null && size > f.maxChars) return false
      if (f.pairing != null && scriptPairing(s.path) !== f.pairing) return false
      if (monoByScript && !monoByScript.has(s.path)) return false // non-null only when f.monologue
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
        added: row?.added ?? row?.mtime, // creation time; mtime fallback for pre-reindex entries
        monologue: monoByScript?.get(s.path) ?? null // set only under the Monologue filter (row hint)
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

  // every indexed path that folds together with `path` in the Browse list (same folder
  // + canonical key — i.e. re-download duplicates). Removing the visible representative
  // must take its hidden twins too, or query() just promotes a twin back into view.
  foldGroup(path: string): string[] {
    const rp = resolve(path)
    const row = this.scripts.get(rp)
    if (!row) return [rp]
    const key = dirname(rp) + '\0' + canonicalKey(row.name)
    return [...this.scripts.values()]
      .filter((s) => dirname(s.path) + '\0' + canonicalKey(s.name) === key)
      .map((s) => s.path)
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
